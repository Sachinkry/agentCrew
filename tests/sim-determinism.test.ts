import { describe, it, expect } from "vitest";
import { mulberry32 } from "../src/sim/traffic.js";

describe("mulberry32 PRNG determinism", () => {
  it("produces identical sequences from the same seed", () => {
    const rng1 = mulberry32(42);
    const rng2 = mulberry32(42);

    const seq1 = Array.from({ length: 100 }, () => rng1());
    const seq2 = Array.from({ length: 100 }, () => rng2());

    expect(seq1).toEqual(seq2);
  });

  it("produces different sequences from different seeds", () => {
    const rng1 = mulberry32(42);
    const rng2 = mulberry32(99);

    const seq1 = Array.from({ length: 10 }, () => rng1());
    const seq2 = Array.from({ length: 10 }, () => rng2());

    expect(seq1).not.toEqual(seq2);
  });

  it("outputs values in [0, 1)", () => {
    const rng = mulberry32(1234);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
