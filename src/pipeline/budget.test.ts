import { describe, expect, it } from "vitest";
import { z } from "zod";
import { TrackingLLM } from "./client";
import { BudgetExceededError } from "./errors";
import { FakeLLM } from "./testing/fake-llm";

const schema = z.object({ ok: z.boolean() });
const call = (llm: TrackingLLM, purpose = "extract") =>
  llm.parse({ model: "claude-opus-5", system: "s", user: "u", schema, purpose });

describe("spend cap", () => {
  it("lets calls through until the cap is reached, then refuses before the next call", async () => {
    // 1,000 in + 200 out on opus-5 = $0.005 + $0.005 = $0.01 per call.
    const fake = new FakeLLM(() => ({ ok: true }));
    const llm = new TrackingLLM(fake, undefined, { maxCostUsd: 0.025 });
    await call(llm);
    await call(llm);
    await call(llm); // spend is now $0.03 ≥ cap
    await expect(call(llm, "brief")).rejects.toBeInstanceOf(BudgetExceededError);
    expect(fake.calls).toHaveLength(3);
    expect(llm.costUsd).toBeCloseTo(0.03, 5);
  });

  it("is unlimited when no cap is given", async () => {
    const llm = new TrackingLLM(new FakeLLM(() => ({ ok: true })));
    for (let i = 0; i < 50; i++) await call(llm);
    expect(llm.calls).toHaveLength(50);
  });

  it("names the purpose and amounts in the error", async () => {
    const llm = new TrackingLLM(new FakeLLM(() => ({ ok: true })), undefined, { maxCostUsd: 0.005 });
    await call(llm);
    const err = await call(llm, "taxonomy").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect((err as BudgetExceededError).message).toMatch(/taxonomy/);
    expect((err as BudgetExceededError).message).toMatch(/\$0\.01 spent of the \$0\.01 cap/);
  });
});
