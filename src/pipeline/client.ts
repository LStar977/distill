import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import {
  BudgetExceededError,
  LLMOutputError,
  LLMRefusalError,
  LLMRequestError,
  LLMTransientError,
  LLMTruncatedError,
  MissingApiKeyError,
} from "./errors";
import { addUsage, costOf, EMPTY_USAGE, type TokenUsage } from "./models";

/**
 * One structured-output call. `system` is the frozen, cacheable prefix
 * (instructions + taxonomy); everything volatile goes in `user`.
 */
export interface ParseParams<T> {
  model: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  /** Short tag used in errors and usage tracking: "extract", "taxonomy", … */
  purpose: string;
  /** Put a cache breakpoint on the system block. Default true. */
  cache?: boolean;
  /**
   * How much the model should think. "off" for bulk, schema-shaped work
   * (thinking tokens count against max_tokens and are billed as output);
   * "medium" for the few synthesis calls where writing quality shows.
   * Mapped per model family in `generationControls`; omitted = API defaults.
   */
  reasoning?: Reasoning;
}

export type Reasoning = "off" | "low" | "medium" | "high";

type Effort = "low" | "medium" | "high";
interface GenerationControls {
  thinking?: Anthropic.ThinkingConfigParam;
  effort?: Effort;
}

/**
 * Haiku 4.5 rejects `effort` and has no adaptive thinking, so it gets nothing.
 * Opus-tier models are never run with thinking disabled (it degrades output);
 * "off" becomes adaptive thinking at low effort there. Sonnet 5 accepts
 * `thinking: disabled`, which is the cheapest setting for extraction.
 */
export function generationControls(model: string, reasoning: Reasoning | undefined): GenerationControls {
  if (reasoning === undefined) return {};
  const m = model.toLowerCase();
  if (m.includes("haiku")) return {};
  const opusTier = m.includes("opus") || m.includes("fable") || m.includes("mythos");
  if (reasoning === "off") {
    return opusTier ? { thinking: { type: "adaptive" }, effort: "low" } : { thinking: { type: "disabled" } };
  }
  return { thinking: { type: "adaptive" }, effort: reasoning };
}

export interface ParseResult<T> {
  output: T;
  usage: TokenUsage;
  model: string;
  /** Retries performed at this layer (on top of the SDK's own). */
  retries: number;
}

export interface LLM {
  parse<T>(params: ParseParams<T>): Promise<ParseResult<T>>;
}

export interface Logger {
  debug?(message: string): void;
  info?(message: string): void;
  warn?(message: string): void;
}

export interface AnthropicLLMOptions {
  client?: Anthropic;
  apiKey?: string;
  /** Attempts at this layer for transient failures. Default 3. */
  maxAttempts?: number;
  /** Base backoff in ms (doubles per attempt, ±25% jitter). Default 1500. */
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  logger?: Logger;
  /** Default max_tokens when a call does not specify one. */
  defaultMaxTokens?: number;
}

/**
 * DISTILL_API_KEY is preferred so the pipeline's key never collides with a
 * developer tool that also reads ANTHROPIC_API_KEY; both are accepted.
 */
export function resolveApiKey(): string | undefined {
  return process.env.DISTILL_API_KEY || process.env.ANTHROPIC_API_KEY || undefined;
}

export function hasCredentials(): boolean {
  return Boolean(resolveApiKey() || process.env.ANTHROPIC_AUTH_TOKEN);
}

export function usageFromSdk(u: Anthropic.Usage): TokenUsage {
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
}

function isTransient(err: unknown): { transient: boolean; status: number | undefined } {
  if (err instanceof Anthropic.RateLimitError) return { transient: true, status: 429 };
  if (err instanceof Anthropic.APIConnectionError) return { transient: true, status: undefined };
  if (err instanceof Anthropic.InternalServerError) return { transient: true, status: err.status };
  if (err instanceof Anthropic.APIError) {
    const status = typeof err.status === "number" ? err.status : undefined;
    return { transient: status !== undefined && status >= 500, status };
  }
  return { transient: false, status: undefined };
}

/** Real implementation over the official SDK. */
export class AnthropicLLM implements LLM {
  private readonly client: Anthropic;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly logger: Logger | undefined;
  private readonly defaultMaxTokens: number;

  constructor(opts: AnthropicLLMOptions = {}) {
    if (opts.client) {
      this.client = opts.client;
    } else {
      const apiKey = opts.apiKey ?? resolveApiKey();
      if (!apiKey && !process.env.ANTHROPIC_AUTH_TOKEN) throw new MissingApiKeyError();
      this.client = new Anthropic(apiKey ? { apiKey } : {});
    }
    this.maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
    this.backoffMs = opts.backoffMs ?? 1500;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.logger = opts.logger;
    this.defaultMaxTokens = opts.defaultMaxTokens ?? 8192;
  }

  async parse<T>(params: ParseParams<T>): Promise<ParseResult<T>> {
    const maxTokens = params.maxTokens ?? this.defaultMaxTokens;
    const systemBlock: Anthropic.TextBlockParam = { type: "text", text: params.system };
    if (params.cache !== false) systemBlock.cache_control = { type: "ephemeral" };
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: params.user }];
    const info = { model: params.model, purpose: params.purpose };
    const controls = generationControls(params.model, params.reasoning);

    let retries = 0;
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await this.client.messages.parse({
          model: params.model,
          max_tokens: maxTokens,
          system: [systemBlock],
          messages,
          ...(controls.thinking ? { thinking: controls.thinking } : {}),
          output_config: {
            format: zodOutputFormat(params.schema),
            ...(controls.effort ? { effort: controls.effort } : {}),
          },
        });

        if (res.stop_reason === "refusal") {
          throw new LLMRefusalError({
            ...info,
            category: res.stop_details?.category ?? null,
            explanation: res.stop_details?.explanation ?? null,
          });
        }
        if (res.stop_reason === "max_tokens" || res.stop_reason === "model_context_window_exceeded") {
          throw new LLMTruncatedError({ ...info, maxTokens, stopReason: res.stop_reason });
        }
        if (res.parsed_output === null || res.parsed_output === undefined) {
          throw new LLMOutputError({ ...info, detail: `stop_reason=${res.stop_reason ?? "null"}` });
        }
        return { output: res.parsed_output, usage: usageFromSdk(res.usage), model: res.model, retries };
      } catch (err) {
        if (err instanceof LLMRefusalError || err instanceof LLMTruncatedError || err instanceof LLMOutputError) throw err;
        const { transient, status } = isTransient(err);
        if (transient) {
          if (attempt >= this.maxAttempts) {
            throw new LLMTransientError({ ...info, status, attempts: attempt, cause: err });
          }
          retries++;
          const base = this.backoffMs * 2 ** (attempt - 1);
          const jitter = base * (0.75 + Math.random() * 0.5);
          this.logger?.warn?.(
            `${params.purpose}: transient failure${status ? ` (HTTP ${status})` : ""}, retrying in ${Math.round(jitter)}ms`,
          );
          await this.sleep(jitter);
          continue;
        }
        if (err instanceof Anthropic.APIError) {
          throw new LLMRequestError({
            ...info,
            status: typeof err.status === "number" ? err.status : undefined,
            detail: err.message,
            cause: err,
          });
        }
        if (err instanceof Anthropic.AnthropicError) {
          // Schema validation failures from the zod parser surface as AnthropicError.
          throw new LLMOutputError({ ...info, detail: err.message, cause: err });
        }
        throw err;
      }
    }
  }
}

/** One recorded call, for the run's cost ledger. */
export interface CallRecord {
  purpose: string;
  model: string;
  usage: TokenUsage;
  costUsd: number;
  retries: number;
}

/** Wraps any LLM and keeps a running total of tokens, cost and cache hits. */
export class TrackingLLM implements LLM {
  readonly calls: CallRecord[] = [];
  private total: TokenUsage = { ...EMPTY_USAGE };
  private cost = 0;
  private retries = 0;

  constructor(
    private readonly inner: LLM,
    private readonly onCall?: (record: CallRecord) => void,
    private readonly opts: { maxCostUsd?: number } = {},
  ) {}

  async parse<T>(params: ParseParams<T>): Promise<ParseResult<T>> {
    const cap = this.opts.maxCostUsd;
    if (cap !== undefined && this.cost >= cap) {
      throw new BudgetExceededError({ spentUsd: this.cost, maxCostUsd: cap, purpose: params.purpose });
    }
    const result = await this.inner.parse(params);
    const record: CallRecord = {
      purpose: params.purpose,
      model: result.model,
      usage: result.usage,
      costUsd: costOf(result.model, result.usage),
      retries: result.retries,
    };
    this.calls.push(record);
    this.total = addUsage(this.total, result.usage);
    this.cost += record.costUsd;
    this.retries += result.retries;
    this.onCall?.(record);
    return result;
  }

  get usage(): TokenUsage {
    return { ...this.total };
  }
  get costUsd(): number {
    return this.cost;
  }
  get retryCount(): number {
    return this.retries;
  }
  /** Usage restricted to calls tagged with a purpose. */
  usageFor(purpose: string): TokenUsage {
    return this.calls.filter((c) => c.purpose === purpose).reduce((acc, c) => addUsage(acc, c.usage), { ...EMPTY_USAGE });
  }
}
