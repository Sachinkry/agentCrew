// Export real check-in economics as inputs for the cfo.ai business plan.
// Usage: pnpm export:cfo   → runs/cfo_inputs.json + a summary on stdout

import fs from "fs";
import { sqlAll, getDb } from "../core/db.js";
import { config } from "../core/config.js";
import { checkInStats, tierEconomics, breakEvenCustomers, type CheckInRow, type Tier } from "./cfo.js";

// Plan assumptions (edit here, then re-run). Measured numbers come from the DB below.
export const TIERS: Tier[] = [
  { name: "Starter", priceUsd: 29, checkInsPerDay: 4 },
  { name: "Growth", priceUsd: 99, checkInsPerDay: 24 },
  { name: "Scale", priceUsd: 299, checkInsPerDay: 96 },
];
export const FIXED_USD_MONTH: Record<string, number> = {
  "Hosting (VM + backups)": 25,
  "Domain + email": 5,
  "Crustdata API (paid plan)": 95, // assumed; currently on the free sandbox
  "Observability (neatlogs)": 0,
};
// What if we move to a model ~10x the price (e.g. for harder customers)?
const STRESS_MULTIPLIER = 10;

// One row per check-in: the operator run plus every helper run under it.
const CHECK_INS_SQL = `
WITH RECURSIVE tree(root, id) AS (
  SELECT id, id FROM agent_runs WHERE parent_id IS NULL AND agent = 'operator'
  UNION ALL SELECT t.root, a.id FROM agent_runs a JOIN tree t ON a.parent_id = t.id)
SELECT r.id, r.status,
  COALESCE(SUM(c.cost_cents), 0) AS cents,
  COALESCE(SUM(c.in_tokens + c.out_tokens), 0) AS tokens,
  COUNT(c.id) AS calls,
  COALESCE((r.ended_at - r.started_at) / 1000.0, 0) AS secs
FROM agent_runs r JOIN tree t ON t.root = r.id LEFT JOIN llm_calls c ON c.span_id = t.id
GROUP BY r.id ORDER BY r.started_at`;

function main() {
  getDb();
  const stats = checkInStats(sqlAll<CheckInRow>(CHECK_INS_SQL));
  if (!stats.checkIns) {
    console.error("No live check-ins yet (run `pnpm agents` with MOCK_LLM=0 first).");
    process.exit(1);
  }
  const fixed = Object.values(FIXED_USD_MONTH).reduce((a, b) => a + b, 0);
  const tiers = TIERS.map((t) => {
    const e = tierEconomics(stats.avgCents, t);
    const stress = tierEconomics(stats.avgCents * STRESS_MULTIPLIER, t);
    return { ...e, breakEvenCustomers: breakEvenCustomers(fixed, e.grossUsdMonth), stressGrossMarginPct: stress.grossMarginPct };
  });
  const out = { model: config.model, measured: stats, fixedUsdMonth: FIXED_USD_MONTH, fixedTotalUsdMonth: fixed, stressMultiplier: STRESS_MULTIPLIER, tiers };

  fs.writeFileSync("runs/cfo_inputs.json", JSON.stringify(out, null, 2));

  const f = (n: number, d = 2) => n.toFixed(d);
  console.log(`Measured over ${stats.checkIns} live check-ins (${stats.failed} failed), model ${config.model}:`);
  console.log(`  cost ${f(stats.avgCents, 3)}¢ · ${Math.round(stats.avgTokens)} tokens · ${f(stats.avgCalls, 1)} calls · ${Math.round(stats.avgSecs)}s per check-in (total ${f(stats.totalCents, 2)}¢)`);
  console.log(`Fixed costs: $${fixed}/month\n`);
  console.log("| Tier | Price/mo | Check-ins/day | Inference/mo | Gross margin | @10x model | Break-even customers |");
  console.log("|---|---|---|---|---|---|---|");
  for (const t of tiers) {
    console.log(`| ${t.name} | $${t.priceUsd} | ${t.checkInsPerDay} | $${f(t.inferenceUsdMonth)} | ${f(t.grossMarginPct, 1)}% | ${f(t.stressGrossMarginPct, 1)}% | ${t.breakEvenCustomers} |`);
  }
  console.log("\nWritten to runs/cfo_inputs.json");
}

main();
