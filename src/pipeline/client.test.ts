import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AnthropicLLM, TrackingLLM } from "./client";
import { LLMRefusalError, LLMTransientError, LLMTruncatedError, MissingApiKeyError } from "./errors";
import { FakeLLM } from "./testing/fake-llm";

const schema = z.object({ answer: z.string() });

type ParseFn = Anthropic["messages"]["parse"];

/** Build a stub client whose messages.parse runs the given sequence of behaviours. */
function stubClient(behaviours: (() => unknown)[]): Anthropic {
  let i = 0;
  const parse = async (): Promise<unknown> => {
    const b = behaviours[Math.min(i, behaviours.length - 1)];
    i++;
    return (b as () => unknown)();
  };
  return { messages: { parse: parse as unknown as ParseFn } } as unknown as Anthropic;
}

function message(overrides: Record<string, unknown>): unknown {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content: [],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 400, cache_creation_input_tokens: 0 },
    parsed_output: { answer: "ok" },
    ...overrides,
  };
}

const params = { model: "claude-sonnet-5", system: "sys", user: "hi", schema, purpose: "test" };

describe("AnthropicLLM", () => {
  it("requires a key when no client is injected", () => {
    const saved = { key: process.env.ANTHROPIC_API_KEY, token: process.env.ANTHROPIC_AUTH_TOKEN };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    try {
      expect(() => new AnthropicLLM()).toThrow(MissingApiKeyError);
    } finally {
      if (saved.key !== undefined) process.env.ANTHROPIC_API_KEY = saved.key;
      if (saved.token !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = saved.token;
    }
  });

  it("returns parsed output and normalized usage", async () => {
    const llm = new AnthropicLLM({ client: stubClient([() => message({})]) });
    const res = await llm.parse(params);
    expect(res.output).toEqual({ answer: "ok" });
    expect(res.usage).toEqual({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 400, cacheWriteTokens: 0 });
    expect(res.retries).toBe(0);
  });

  it("surfaces refusals and truncation as typed errors", async () => {
    const refused = new AnthropicLLM({
      client: stubClient([() => message({ stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: "no" }, parsed_output: null })]),
    });
    await expect(refused.parse(params)).rejects.toBeInstanceOf(LLMRefusalError);
    const truncated = new AnthropicLLM({ client: stubClient([() => message({ stop_reason: "max_tokens", parsed_output: null })]) });
    await expect(truncated.parse(params)).rejects.toBeInstanceOf(LLMTruncatedError);
  });

  it("retries rate limits and connection errors with backoff, then succeeds", async () => {
    const sleeps: number[] = [];
    const llm = new AnthropicLLM({
      client: stubClient([
        () => {
          throw new Anthropic.RateLimitError(429, { type: "rate_limit_error" }, "slow down", new Headers());
        },
        () => {
          throw new Anthropic.APIConnectionError({ message: "socket hang up" });
        },
        () => message({}),
      ]),
      maxAttempts: 3,
      backoffMs: 10,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    const res = await llm.parse(params);
    expect(res.retries).toBe(2);
    expect(sleeps).toHaveLength(2);
  });

  it("gives up with LLMTransientError after maxAttempts", async () => {
    const llm = new AnthropicLLM({
      client: stubClient([
        () => {
          throw new Anthropic.InternalServerError(503, { type: "overloaded_error" }, "overloaded", new Headers());
        },
      ]),
      maxAttempts: 2,
      sleep: async () => {},
    });
    await expect(llm.parse(params)).rejects.toMatchObject({ name: "LLMTransientError", attempts: 2, status: 503 });
    await expect(llm.parse(params)).rejects.toBeInstanceOf(LLMTransientError);
  });
});

describe("TrackingLLM", () => {
  it("accumulates tokens, cost and retries across calls", async () => {
    const fake = new FakeLLM(() => ({ answer: "x" }), { usage: { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } });
    const tracker = new TrackingLLM(fake);
    await tracker.parse({ ...params, model: "claude-sonnet-5", purpose: "a" });
    await tracker.parse({ ...params, model: "claude-opus-5", purpose: "b" });
    expect(tracker.usage.inputTokens).toBe(2_000_000);
    expect(tracker.costUsd).toBeCloseTo(7, 6); // 2 + 5
    expect(tracker.calls.map((c) => c.purpose)).toEqual(["a", "b"]);
    expect(tracker.usageFor("a").inputTokens).toBe(1_000_000);
  });
});
