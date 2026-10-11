import { describe, it, expect } from "vitest";
import { planTurn } from "../src/core/budget.js";

// planTurn(left, nextPrompt, pastReplies): nextPrompt is the size of the prompt about to be sent
// (known exactly: tool results are already in the history); replies are past output token counts.
describe("planTurn", () => {
  it("is normal on the first turn", () => {
    expect(planTurn(Infinity, 1_500, [])).toBe("normal");
    expect(planTurn(20_000, 1_500, [])).toBe("normal");
  });
  it("is final when this turn fits but the one after doesn't", () => {
    // this turn ≈ 4000 + 500; the next ≈ 4500 + 500 → needs ~9500
    expect(planTurn(9_000, 4_000, [500])).toBe("final");
  });
  it("is normal when two more turns fit", () => {
    expect(planTurn(12_000, 4_000, [500])).toBe("normal");
  });

  // check-in 8: Content, 15k grant, after turns of 1872/218 and 3081/832 tokens it had 8997 left,
  // sent a 3937-token prompt, then was stopped needing ~4810. That 3rd turn must be final.
  it("regression: check-in 8 Content gets its final turn in time", () => {
    expect(planTurn(8_997, 3_937, [218, 832])).toBe("final");
  });

  // check-in 13: Content, 20k grant, after turns of 1828/102 and 3139/2226 it had 12705 left and
  // its next prompt was 2533. The old cost-growth rule forced a final turn here; the turn cost 3408
  // and two more would have fit.
  it("regression: check-in 13 Content is not wrapped up early after one long reply", () => {
    expect(planTurn(12_705, 2_533, [102, 2_226])).toBe("normal");
  });
});
