import { describe, it, expect } from "vitest";
import { checkSpend, isBudgetStop, SpendLimitReached, TokenBudgetExceeded } from "../src/core/budget.js";

describe("spend guard", () => {
  it("allows calls under the limit", () => {
    expect(() => checkSpend(139, 140)).not.toThrow();
  });
  // check-in 16: the guard threw a plain Error, so the whole operator run was marked failed
  it("regression: throws SpendLimitReached (not a plain Error) at the limit", () => {
    expect(() => checkSpend(140, 140)).toThrow(SpendLimitReached);
    expect(() => checkSpend(140, 140)).toThrow(/\$1\.40 spent of \$1\.40/);
  });
  it("the agent loop treats both budget limits as a clean stop", () => {
    expect(isBudgetStop(new SpendLimitReached("x"))).toBe(true);
    expect(isBudgetStop(new TokenBudgetExceeded("x"))).toBe(true);
    expect(isBudgetStop(new Error("OpenRouter 500"))).toBe(false);
  });
});
