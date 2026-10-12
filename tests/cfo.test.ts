import { describe, it, expect } from "vitest";
import { checkInStats, tierEconomics, breakEvenCustomers, type CheckInRow } from "../src/eval/cfo.js";

// Live check-ins, 2026-10-11 (one row per operator run incl. its helpers; cents from OpenRouter usage.cost).
const live: CheckInRow[] = [
  ["4cf113d9", "done", 0, 0, 0, 0], // mock run: no model calls
  ["dbf1c09f", "done", 0.844, 21146, 8, 50],
  ["87c71672", "done", 0.323, 21646, 9, 45],
  ["752e8d84", "done", 0.417, 24058, 8, 37],
  ["a47c429e", "done", 0.836, 31264, 11, 52],
  ["9eba2887", "done", 1.158, 47807, 13, 62],
  ["e77bde38", "done", 0.452, 31770, 10, 55],
  ["e0517c53", "done", 1.096, 41531, 13, 87],
  ["44e3802c", "done", 0.589, 42512, 12, 133],
  ["c76fe80a", "done", 1.243, 40973, 12, 60],
  ["16120558", "done", 0.966, 39196, 12, 48],
  ["b122a43e", "done", 1.13, 41018, 12, 60],
  ["38898899", "done", 1.002, 42524, 12, 103],
  ["494ace14", "failed", 0.563, 20925, 8, 77],
].map(([id, status, cents, tokens, calls, secs]) => ({ id, status, cents, tokens, calls, secs }) as CheckInRow);

describe("checkInStats", () => {
  const s = checkInStats(live);
  it("counts only check-ins that called the model", () => {
    expect(s.checkIns).toBe(13);
    expect(s.failed).toBe(1);
  });
  it("averages the real cost, tokens and duration", () => {
    expect(s.totalCents).toBeCloseTo(10.619, 3);
    expect(s.avgCents).toBeCloseTo(0.8168, 3);
    expect(Math.round(s.avgTokens)).toBe(34336);
    expect(Math.round(s.avgSecs)).toBe(67);
  });
  it("is all zeros with no live check-ins", () => {
    expect(checkInStats([]).avgCents).toBe(0);
  });
});

describe("tierEconomics", () => {
  it("hourly check-ins cost ~$5.88 of inference a month; at $99 that is a ~94% gross margin", () => {
    const t = tierEconomics(0.8168, { name: "Growth", priceUsd: 99, checkInsPerDay: 24 });
    expect(t.inferenceUsdMonth).toBeCloseTo(5.88, 2);
    expect(t.grossMarginPct).toBeCloseTo(94.06, 1);
  });
  it("a 10x pricier model still leaves a positive margin on the same tier", () => {
    const t = tierEconomics(0.8168 * 10, { name: "Growth", priceUsd: 99, checkInsPerDay: 24 });
    expect(t.inferenceUsdMonth).toBeCloseTo(58.81, 1);
    expect(t.grossMarginPct).toBeGreaterThan(0);
  });
});

describe("breakEvenCustomers", () => {
  it("rounds up to whole customers", () => {
    expect(breakEvenCustomers(300, 93.12)).toBe(4);
  });
  it("is Infinity when a customer doesn't cover their own cost", () => {
    expect(breakEvenCustomers(300, 0)).toBe(Infinity);
  });
});
