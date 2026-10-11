// Export run metrics to CSV/JSON for cfo.ai business model.
// Usage: pnpm export:cfo <run_id>

import { getDb } from "../core/db.js";
import { runMetrics, orders, products, ledger } from "../core/schema.js";
import { eq, sql } from "drizzle-orm";
import fs from "fs";

const [, , runId = ""] = process.argv;

if (!runId) {
  console.error("Usage: pnpm export:cfo <run_id>");
  process.exit(1);
}

async function main() {
  const db = getDb();

  const rows = db
    .select()
    .from(runMetrics)
    .where(eq(runMetrics.runId, runId))
    .all();

  if (rows.length === 0) {
    console.error(`No metrics found for run ${runId}`);
    process.exit(1);
  }

  // Aggregate
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalProfit = rows.reduce((s, r) => s + r.profit, 0);
  const totalInference = rows.reduce((s, r) => s + r.inferenceCost, 0);
  const totalOrders = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(orders)
    .get()?.count ?? 0;

  const platformFee = db
    .select({ total: sql<number>`COALESCE(SUM(ABS(amount_cents)), 0)` })
    .from(ledger)
    .where(eq(ledger.kind, "fee"))
    .get()?.total ?? 0;

  const revenuePerOrder = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  const inferencePerOrder = totalOrders > 0 ? totalInference / totalOrders : 0;
  const platformFeePerOrder = totalOrders > 0 ? platformFee / totalOrders : 0;
  const grossMarginPct =
    totalRevenue > 0
      ? ((totalRevenue - platformFee) / totalRevenue) * 100
      : 0;
  const netMarginPct =
    totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

  const summary = {
    run_id: runId,
    sim_days: rows.length,
    total_orders: totalOrders,
    total_revenue_usd: (totalRevenue / 100).toFixed(2),
    total_profit_usd: (totalProfit / 100).toFixed(2),
    total_inference_cost_usd: (totalInference / 100).toFixed(2),
    platform_fees_usd: (platformFee / 100).toFixed(2),
    avg_revenue_per_order_usd: (revenuePerOrder / 100).toFixed(2),
    avg_inference_per_order_cents: inferencePerOrder.toFixed(1),
    avg_platform_fee_per_order_cents: platformFeePerOrder.toFixed(1),
    gross_margin_pct: grossMarginPct.toFixed(1),
    net_margin_pct: netMarginPct.toFixed(1),
    projections: {
      "10_orders_month": {
        revenue_usd: ((revenuePerOrder / 100) * 10).toFixed(2),
        profit_usd: (((totalProfit / Math.max(totalOrders, 1)) / 100) * 10).toFixed(2),
      },
      "100_orders_month": {
        revenue_usd: ((revenuePerOrder / 100) * 100).toFixed(2),
        profit_usd: (((totalProfit / Math.max(totalOrders, 1)) / 100) * 100).toFixed(2),
      },
      "1000_orders_month": {
        revenue_usd: ((revenuePerOrder / 100) * 1000).toFixed(2),
        profit_usd: (((totalProfit / Math.max(totalOrders, 1)) / 100) * 1000).toFixed(2),
      },
    },
  };

  // JSON output
  const jsonPath = `runs/cfo_export_${runId.slice(0, 8)}.json`;
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2));
  console.log(`CFO export written to ${jsonPath}`);

  // CSV output (daily)
  const csvRows = [
    "sim_day,revenue_usd,profit_usd,inference_cost_usd,orders,policy_blocks,claim_verified_rate",
    ...rows.map((r) =>
      [
        r.simDay,
        (r.revenue / 100).toFixed(2),
        (r.profit / 100).toFixed(2),
        (r.inferenceCost / 100).toFixed(2),
        0,
        r.policyBlocks,
        (r.claimVerifiedRate ?? 0).toFixed(2),
      ].join(",")
    ),
  ].join("\n");

  const csvPath = `runs/cfo_daily_${runId.slice(0, 8)}.csv`;
  fs.writeFileSync(csvPath, csvRows);
  console.log(`Daily CSV written to ${csvPath}`);

  console.log("\n── Summary ──");
  console.log(`Revenue: $${summary.total_revenue_usd}`);
  console.log(`Profit: $${summary.total_profit_usd}`);
  console.log(`Net Margin: ${summary.net_margin_pct}%`);
  console.log(`Avg inference/order: ${summary.avg_inference_per_order_cents}¢`);
}

main().catch(console.error);
