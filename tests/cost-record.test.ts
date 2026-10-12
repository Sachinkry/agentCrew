import { describe, it, expect } from "vitest";
import { recordLlmCost } from "../src/core/agent.js";
import { inferenceSpentCents } from "../src/core/model.js";
import { sqlAll } from "../src/core/db.js";

// Live data, 2026-10-11: 140 deepseek-v4.1-flash calls really cost 10.62¢ in total
// (agent_runs.cost_cents), but each was booked as Math.ceil(0.076¢) = 1¢. The spend
// guard then saw $1.40 and stopped check-in 16/17 at LLM_BUDGET_CENTS=140.
describe("regression: inference cost is booked at its real fraction of a cent", () => {
  const ctx = { simDay: 0, agentRunId: "test-run" };
  const perCall = 10.62 / 140;

  it("140 calls add up to ~10.6¢ of spend, not 140¢", () => {
    for (let i = 0; i < 140; i++) recordLlmCost("content", ctx, "m", 2_000, 700, perCall);
    expect(inferenceSpentCents()).toBeCloseTo(10.62, 6);
    const [row] = sqlAll<{ c: number }>(`SELECT SUM(cost_cents) AS c FROM llm_calls`);
    expect(row!.c).toBeCloseTo(10.62, 6);
  });
});
