// Before/after comparison across two run IDs.
// Usage: pnpm eval:compare <run_id_a> <run_id_b>

import { getDb } from "../core/db.js";
import { runMetrics } from "../core/schema.js";
import { eq, sql } from "drizzle-orm";

const [, , runA, runB] = process.argv;

if (!runA || !runB) {
  console.error("Usage: pnpm eval:compare <run_id_a> <run_id_b>");
  process.exit(1);
}

function aggregate(runId: string) {
  const db = getDb();
  const rows = db
    .select()
    .from(runMetrics)
    .where(eq(runMetrics.runId, runId))
    .all();

  if (rows.length === 0) return null;

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalProfit = rows.reduce((s, r) => s + r.profit, 0);
  const totalInference = rows.reduce((s, r) => s + r.inferenceCost, 0);
  const totalBlocks = rows.reduce((s, r) => s + r.policyBlocks, 0);

  const lastRow = rows[rows.length - 1];
  const claimVerifiedRate =
    rows.reduce((s, r) => s + (r.claimVerifiedRate ?? 0), 0) / rows.length;

  const avgCostPerOrder =
    rows.filter((r) => r.costPerOrder !== null).reduce((s, r) => s + (r.costPerOrder ?? 0), 0) /
    Math.max(1, rows.filter((r) => r.costPerOrder !== null).length);

  // Channel conversion from last row
  const conv = lastRow?.conversionByChannelJson
    ? JSON.parse(lastRow.conversionByChannelJson)
    : {};

  return {
    runId,
    days: rows.length,
    totalRevenueCents: totalRevenue,
    totalProfitCents: totalProfit,
    totalInferenceCostCents: totalInference,
    policyBlocks: totalBlocks,
    claimVerifiedRate: claimVerifiedRate.toFixed(2),
    avgCostPerOrderCents: avgCostPerOrder.toFixed(1),
    webConversionRate: ((conv["web"]?.rate ?? 0) * 100).toFixed(2) + "%",
    xConversionRate: ((conv["x"]?.rate ?? 0) * 100).toFixed(2) + "%",
  };
}

function delta(a: number | string, b: number | string): string {
  const na = parseFloat(String(a));
  const nb = parseFloat(String(b));
  if (isNaN(na) || isNaN(nb)) return "—";
  const d = nb - na;
  const sign = d >= 0 ? "+" : "";
  return `${sign}${d.toFixed(1)}`;
}

async function main() {
  const a = aggregate(runA);
  const b = aggregate(runB);

  if (!a || !b) {
    console.error("One or both runs not found in DB");
    process.exit(1);
  }

  const rows: [string, string, string, string][] = [
    ["Metric", `Run A (${runA.slice(0, 8)})`, `Run B (${runB.slice(0, 8)})`, "Delta"],
    ["---", "---", "---", "---"],
    ["Days simulated", String(a.days), String(b.days), delta(a.days, b.days)],
    [
      "Total Revenue",
      `$${(a.totalRevenueCents / 100).toFixed(2)}`,
      `$${(b.totalRevenueCents / 100).toFixed(2)}`,
      `$${(((b.totalRevenueCents - a.totalRevenueCents) / 100)).toFixed(2)}`,
    ],
    [
      "Total Profit",
      `$${(a.totalProfitCents / 100).toFixed(2)}`,
      `$${(b.totalProfitCents / 100).toFixed(2)}`,
      `$${(((b.totalProfitCents - a.totalProfitCents) / 100)).toFixed(2)}`,
    ],
    [
      "Inference Cost",
      `$${(a.totalInferenceCostCents / 100).toFixed(2)}`,
      `$${(b.totalInferenceCostCents / 100).toFixed(2)}`,
      `$${(((b.totalInferenceCostCents - a.totalInferenceCostCents) / 100)).toFixed(2)}`,
    ],
    ["Policy Blocks", String(a.policyBlocks), String(b.policyBlocks), delta(a.policyBlocks, b.policyBlocks)],
    ["Claim Verified Rate", String(a.claimVerifiedRate), String(b.claimVerifiedRate), delta(a.claimVerifiedRate, b.claimVerifiedRate)],
    ["Avg Cost/Order (¢)", String(a.avgCostPerOrderCents), String(b.avgCostPerOrderCents), delta(a.avgCostPerOrderCents, b.avgCostPerOrderCents)],
    ["Web Conversion", a.webConversionRate, b.webConversionRate, delta(a.webConversionRate, b.webConversionRate)],
    ["X Conversion", a.xConversionRate, b.xConversionRate, delta(a.xConversionRate, b.xConversionRate)],
  ];

  // Print markdown table
  const md = rows
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");

  console.log("\n## Before/After Comparison\n");
  console.log(md);
  console.log();
}

main().catch(console.error);
