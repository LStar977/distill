import type { StageName } from "../lib/types";

/** Base class for every error the pipeline raises on purpose. */
export class PipelineError extends Error {
  readonly code: string;
  readonly stage?: StageName;
  constructor(code: string, message: string, opts: { stage?: StageName; cause?: unknown } = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "PipelineError";
    this.code = code;
    this.stage = opts.stage;
  }
}

/** Thrown when a dataset file, golden set or CSV cannot be read or is malformed. */
export class DatasetError extends PipelineError {
  constructor(message: string, opts: { cause?: unknown } = {}) {
    super("dataset", message, { stage: "ingest", ...opts });
    this.name = "DatasetError";
  }
}

/** Base class for model-call failures. */
export class LLMError extends PipelineError {
  readonly model: string;
  readonly purpose: string;
  constructor(code: string, message: string, info: { model: string; purpose: string; cause?: unknown }) {
    super(code, message, { cause: info.cause });
    this.name = "LLMError";
    this.model = info.model;
    this.purpose = info.purpose;
  }
}

/** `stop_reason === "refusal"`. */
export class LLMRefusalError extends LLMError {
  readonly category: string | null;
  readonly explanation: string | null;
  constructor(info: { model: string; purpose: string; category: string | null; explanation: string | null }) {
    super(
      "llm_refusal",
      `${info.model} refused the ${info.purpose} request${info.category ? ` (${info.category})` : ""}${
        info.explanation ? `: ${info.explanation}` : ""
      }`,
      info,
    );
    this.name = "LLMRefusalError";
    this.category = info.category;
    this.explanation = info.explanation;
  }
}

/** `stop_reason === "max_tokens"` (or the context window was exceeded). */
export class LLMTruncatedError extends LLMError {
  readonly maxTokens: number;
  constructor(info: { model: string; purpose: string; maxTokens: number; stopReason: string }) {
    super(
      "llm_truncated",
      `${info.model} stopped early on the ${info.purpose} request (${info.stopReason}, max_tokens=${info.maxTokens})`,
      info,
    );
    this.name = "LLMTruncatedError";
    this.maxTokens = info.maxTokens;
  }
}

/** The model returned something that did not satisfy the output schema. */
export class LLMOutputError extends LLMError {
  constructor(info: { model: string; purpose: string; cause?: unknown; detail?: string }) {
    super(
      "llm_output",
      `${info.model} returned an unparseable ${info.purpose} response${info.detail ? `: ${info.detail}` : ""}`,
      info,
    );
    this.name = "LLMOutputError";
  }
}

/** Rate limits, connection failures and 5xx after all retries were spent. */
export class LLMTransientError extends LLMError {
  readonly status: number | undefined;
  readonly attempts: number;
  constructor(info: { model: string; purpose: string; status: number | undefined; attempts: number; cause?: unknown }) {
    super(
      "llm_transient",
      `${info.model} ${info.purpose} request failed after ${info.attempts} attempt${info.attempts === 1 ? "" : "s"}${
        info.status ? ` (HTTP ${info.status})` : " (connection error)"
      }`,
      info,
    );
    this.name = "LLMTransientError";
    this.status = info.status;
    this.attempts = info.attempts;
  }
}

/** 4xx that will not get better with a retry: bad key, bad request, etc. */
export class LLMRequestError extends LLMError {
  readonly status: number | undefined;
  constructor(info: { model: string; purpose: string; status: number | undefined; detail: string; cause?: unknown }) {
    super("llm_request", `${info.model} ${info.purpose} request rejected${info.status ? ` (HTTP ${info.status})` : ""}: ${info.detail}`, info);
    this.name = "LLMRequestError";
    this.status = info.status;
  }
}

/** Thrown before any call is made when no credentials are configured. */
export class MissingApiKeyError extends PipelineError {
  constructor() {
    super(
      "missing_api_key",
      "No API key found. Set DISTILL_API_KEY (or ANTHROPIC_API_KEY), or copy .env.example to .env, before running the pipeline.",
    );
    this.name = "MissingApiKeyError";
  }
}

/** Thrown before a call would push cumulative spend past the configured cap. */
export class BudgetExceededError extends PipelineError {
  readonly spentUsd: number;
  readonly maxCostUsd: number;
  constructor(info: { spentUsd: number; maxCostUsd: number; purpose: string }) {
    super(
      "budget_exceeded",
      `Stopped before the ${info.purpose} call: $${info.spentUsd.toFixed(2)} spent of the $${info.maxCostUsd.toFixed(2)} cap. Raise --max-cost to continue.`,
    );
    this.name = "BudgetExceededError";
    this.spentUsd = info.spentUsd;
    this.maxCostUsd = info.maxCostUsd;
  }
}
