import { describe, it, expect } from "vitest";
import { delegate } from "../src/agents/operator.js";
import { withTokenBudget, chargeTokens, GRANT_POLICY } from "../src/core/budget.js";

const L = 50_000;
const reserve = Math.floor(L * GRANT_POLICY.operatorReserve);

describe("operator delegate()", () => {
  it("runs the job in a policy-sized grant and reports grant use and tokens left in the run", async () => {
    await withTokenBudget(async () => {
      const out = await delegate("analytics", async () => {
        chargeTokens("analytics", 1_500);
        return { agentRunId: "r1", answer: "ok" };
      });
      expect(out).toEqual({
        agentRunId: "r1",
        answer: "ok",
        tokens: { granted: Math.floor(L * GRANT_POLICY.defaults["analytics"]!), used: 1_500, runLeft: L - 1_500, freeForJobs: L - 1_500 - reserve },
      });
    }, L);
  });

  it("refuses with a readable error and does not run the job when the pool is too small", async () => {
    let ran = false;
    await withTokenBudget(async () => {
      chargeTokens("operator", L - reserve - 100);
      await expect(
        delegate("content", async () => {
          ran = true;
          return { agentRunId: "x", answer: "" };
        })
      ).rejects.toThrow(/NOT RUN: content not started: only 100 tokens free/);
    }, L);
    expect(ran).toBe(false);
  });
});
