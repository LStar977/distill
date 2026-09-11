import type { LLM, ParseParams, ParseResult } from "../client";
import type { TokenUsage } from "../models";

export type FakeHandler = (params: ParseParams<unknown>, callIndex: number) => unknown | Promise<unknown>;

export interface FakeLLMOptions {
  /** Usage reported for every call. Cache reads kick in from the second call with the same system prompt. */
  usage?: Partial<TokenUsage>;
  /** Simulate prompt caching: repeated system prompts report cache reads instead of input tokens. */
  simulateCache?: boolean;
}

/**
 * A deterministic LLM for tests. The handler returns a plain object; the fake
 * validates it against the call's zod schema exactly like the real parser
 * would, so a test that returns the wrong shape fails loudly.
 */
export class FakeLLM implements LLM {
  readonly calls: ParseParams<unknown>[] = [];
  private readonly seenSystems = new Set<string>();

  constructor(
    private readonly handler: FakeHandler,
    private readonly opts: FakeLLMOptions = {},
  ) {}

  async parse<T>(params: ParseParams<T>): Promise<ParseResult<T>> {
    const index = this.calls.length;
    this.calls.push(params as ParseParams<unknown>);
    const raw = await this.handler(params as ParseParams<unknown>, index);
    const parsed = params.schema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`FakeLLM: handler output for "${params.purpose}" does not match schema: ${parsed.error.message}`);
    }
    const base: TokenUsage = {
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      ...this.opts.usage,
    };
    let usage = base;
    if (this.opts.simulateCache && params.cache !== false) {
      if (this.seenSystems.has(params.system)) {
        usage = { ...base, cacheReadTokens: Math.round(base.inputTokens * 0.8), inputTokens: Math.round(base.inputTokens * 0.2) };
      } else {
        this.seenSystems.add(params.system);
        usage = { ...base, cacheWriteTokens: Math.round(base.inputTokens * 0.8), inputTokens: Math.round(base.inputTokens * 0.2) };
      }
    }
    return { output: parsed.data, usage, model: params.model, retries: 0 };
  }

  callsFor(purpose: string): ParseParams<unknown>[] {
    return this.calls.filter((c) => c.purpose === purpose);
  }
}
