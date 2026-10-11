import { describe, it, expect } from "vitest";
import {
  withTokenBudget,
  withGrant,
  decideGrant,
  grantPool,
  tokensLeft,
  chargeTokens,
  BudgetRefused,
  GRANT_POLICY,
} from "../src/core/budget.js";

const L = 50_000;
const reserve = Math.floor(L * GRANT_POLICY.operatorReserve);

describe("outside a run", () => {
  it("has no limits", () => {
    expect(tokensLeft("content")).toBe(Infinity);
    expect(grantPool()).toBe(Infinity);
  });
});

describe("decideGrant", () => {
  it("gives the agent's default share of the run when nothing is requested", async () => {
    await withTokenBudget(async () => {
      expect(decideGrant("content")).toEqual({ ok: true, tokens: Math.floor(L * GRANT_POLICY.defaults["content"]!) });
    }, L);
  });

  it("gives what was requested when the pool has room", async () => {
    await withTokenBudget(async () => {
      expect(decideGrant("analytics", 7_000)).toEqual({ ok: true, tokens: 7_000 });
    }, L);
  });

  it("keeps the operator reserve out of the pool", async () => {
    await withTokenBudget(async () => {
      expect(grantPool()).toBe(L - reserve);
      chargeTokens("operator", 10_000);
      expect(grantPool()).toBe(L - 10_000 - reserve);
    }, L);
  });

  it("clips a request to the pool", async () => {
    await withTokenBudget(async () => {
      chargeTokens("operator", 25_000);
      const pool = L - 25_000 - reserve;
      expect(decideGrant("content", 30_000)).toEqual({ ok: true, tokens: pool });
    }, L);
  });

  it("refuses when the pool is below the agent's minimum, naming the numbers", async () => {
    await withTokenBudget(async () => {
      chargeTokens("operator", L - reserve - 1_000); // pool = 1000
      const d = decideGrant("content");
      expect(d.ok).toBe(false);
      if (!d.ok) expect(d.reason).toMatch(/content.*1000.*6000/);
    }, L);
  });

  it("refuses a request below the agent's minimum", async () => {
    await withTokenBudget(async () => {
      expect(decideGrant("content", 500).ok).toBe(false);
    }, L);
  });
});

describe("withGrant", () => {
  it("limits the job to its grant and counts its spend against the run", async () => {
    const { used } = await withTokenBudget(async () => {
      await withGrant("analytics", 5_000, async () => {
        expect(tokensLeft("analytics")).toBe(5_000);
        chargeTokens("analytics", 2_000);
        expect(tokensLeft("analytics")).toBe(3_000);
      });
    }, L);
    expect(used).toBe(2_000);
  });

  it("returns the unused part of a grant to the pool", async () => {
    await withTokenBudget(async () => {
      const r = await withGrant("analytics", 8_000, async () => chargeTokens("analytics", 2_000));
      expect(r).toMatchObject({ granted: 8_000, used: 2_000 });
      expect(grantPool()).toBe(L - 2_000 - reserve);
    }, L);
  });

  it("holds an active grant out of the pool so parallel jobs can't overcommit", async () => {
    await withTokenBudget(async () => {
      await withGrant("content", 20_000, async () => {
        expect(grantPool()).toBe(L - reserve - 20_000);
      });
    }, L);
  });

  it("charges nested helper calls (verify) to the same grant", async () => {
    await withTokenBudget(async () => {
      await withGrant("content", 10_000, async () => {
        chargeTokens("verify", 4_000);
        expect(tokensLeft("content")).toBe(6_000);
        expect(tokensLeft("verify")).toBe(6_000);
      });
    }, L);
  });

  it("throws BudgetRefused without running the job when the grant is refused", async () => {
    let ran = false;
    await withTokenBudget(async () => {
      chargeTokens("operator", L - reserve);
      await expect(withGrant("content", undefined, async () => { ran = true; })).rejects.toBeInstanceOf(BudgetRefused);
    }, L);
    expect(ran).toBe(false);
  });
});

// Replay of live check-in 7 (2026-10-12, agent run a47c429e): per-call tokens from llm_calls.
// Under fixed shares Content was stopped with ~4171 left needing ~5833, while 18.7k of the run went unspent.
describe("regression: check-in 7 token starvation", () => {
  const beforeContent: [string, number][] = [
    ["operator", 1260], ["operator", 1526], ["analytics", 1517], ["analytics", 3651],
    ["operator", 2913], ["analytics", 1727], ["operator", 3523],
  ];
  const contentCalls = [1803, 3313, 5713];
  const nextContentCallNeeds = 5833;

  it("lets Content make its next call instead of stopping", async () => {
    await withTokenBudget(async () => {
      for (const [a, n] of beforeContent) chargeTokens(a, n);
      await withGrant("content", undefined, async () => {
        for (const n of contentCalls) chargeTokens("content", n);
        expect(tokensLeft("content")).toBeGreaterThanOrEqual(nextContentCallNeeds);
      });
      // and the operator still has its reserve to write the summary
      expect(tokensLeft("operator")).toBeGreaterThanOrEqual(reserve);
    }, L);
  });
});
