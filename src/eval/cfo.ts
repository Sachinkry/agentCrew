// Unit economics for the cfo.ai business plan, from real check-ins (operator run + its helpers).

export interface CheckInRow {
  id: string;
  status: string;
  cents: number; // real model spend (OpenRouter usage.cost)
  tokens: number;
  calls: number;
  secs: number;
}

export interface Tier {
  name: string;
  priceUsd: number; // per month
  checkInsPerDay: number;
}

export const DAYS_PER_MONTH = 30;

/** Averages over check-ins that called the model (mock runs are left out). */
export function checkInStats(rows: CheckInRow[]) {
  const live = rows.filter((r) => r.calls > 0);
  const n = live.length;
  const sum = (f: (r: CheckInRow) => number) => live.reduce((a, r) => a + f(r), 0);
  const avg = (f: (r: CheckInRow) => number) => (n ? sum(f) / n : 0);
  return {
    checkIns: n,
    failed: live.filter((r) => r.status === "failed").length,
    totalCents: sum((r) => r.cents),
    avgCents: avg((r) => r.cents),
    avgTokens: avg((r) => r.tokens),
    avgCalls: avg((r) => r.calls),
    avgSecs: avg((r) => r.secs),
  };
}

/** Inference cost and gross margin of one customer on a tier. */
export function tierEconomics(avgCentsPerCheckIn: number, tier: Tier) {
  const inferenceUsdMonth = (avgCentsPerCheckIn * tier.checkInsPerDay * DAYS_PER_MONTH) / 100;
  const grossUsdMonth = tier.priceUsd - inferenceUsdMonth;
  return {
    ...tier,
    inferenceUsdMonth,
    grossUsdMonth,
    grossMarginPct: tier.priceUsd > 0 ? (grossUsdMonth / tier.priceUsd) * 100 : 0,
  };
}

/** Customers needed for gross profit to cover fixed monthly costs. */
export function breakEvenCustomers(fixedUsdMonth: number, grossUsdPerCustomer: number): number {
  return grossUsdPerCustomer > 0 ? Math.ceil(fixedUsdMonth / grossUsdPerCustomer) : Infinity;
}
