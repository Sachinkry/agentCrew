// Read-only metric views over ledger + orders + traffic.

import { getDb } from "../core/db.js";
import { ledger, orders, traffic, channels, runMetrics } from "../core/schema.js";
import { eq, sql, and } from "drizzle-orm";
import { randomUUID } from "crypto";

export interface DayMetrics {
  simDay: number;
  revenueCents: number;
  profitCents: number;
  inferenceCostCents: number;
  orderCount: number;
  costPerOrder: number | null;
  conversionByChannel: Record<string, { sessions: number; orders: number; rate: number }>;
  claimVerifiedRate: number | null;
  policyBlocks: number;
}

export interface RunSummary {
  totalRevenueCents: number;
  totalProfitCents: number;
  totalInferenceCostCents: number;
  totalOrders: number;
  days: DayMetrics[];
}

export async function getDayMetrics(simDay: number): Promise<DayMetrics> {
  const db = getDb();

  // Revenue
  const revRow = db
    .select({ total: sql<number>`COALESCE(SUM(amount_cents), 0)` })
    .from(ledger)
    .where(sql`${ledger.simDay} = ${simDay} AND ${ledger.kind} = 'revenue'`)
    .get();
  const revenueCents = revRow?.total ?? 0;

  // Profit (all ledger entries for this day)
  const profitRow = db
    .select({ total: sql<number>`COALESCE(SUM(amount_cents), 0)` })
    .from(ledger)
    .where(eq(ledger.simDay, simDay))
    .get();
  const profitCents = profitRow?.total ?? 0;

  // Inference cost
  const infRow = db
    .select({ total: sql<number>`COALESCE(SUM(ABS(amount_cents)), 0)` })
    .from(ledger)
    .where(sql`${ledger.simDay} = ${simDay} AND ${ledger.kind} = 'inference'`)
    .get();
  const inferenceCostCents = infRow?.total ?? 0;

  // Order count
  const orderRow = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(orders)
    .where(eq(orders.simDay, simDay))
    .get();
  const orderCount = orderRow?.count ?? 0;

  const costPerOrder =
    orderCount > 0 ? inferenceCostCents / orderCount : null;

  // Conversion by channel
  const channelRows = db
    .select({
      name: channels.name,
      sessions: sql<number>`COALESCE(SUM(${traffic.sessions}), 0)`,
      carts: sql<number>`COALESCE(SUM(${traffic.addToCart}), 0)`,
    })
    .from(traffic)
    .leftJoin(channels, eq(traffic.channelId, channels.id))
    .where(eq(traffic.simDay, simDay))
    .groupBy(channels.name)
    .all();

  const ordersByChannel = db
    .select({
      name: channels.name,
      count: sql<number>`COUNT(*)`,
    })
    .from(orders)
    .leftJoin(channels, eq(orders.channelId, channels.id))
    .where(eq(orders.simDay, simDay))
    .groupBy(channels.name)
    .all();

  const conversionByChannel: DayMetrics["conversionByChannel"] = {};
  for (const row of channelRows) {
    if (!row.name) continue;
    const ord = ordersByChannel.find((o) => o.name === row.name);
    const orderCount2 = ord?.count ?? 0;
    conversionByChannel[row.name] = {
      sessions: row.sessions,
      orders: orderCount2,
      rate: row.sessions > 0 ? orderCount2 / row.sessions : 0,
    };
  }

  return {
    simDay,
    revenueCents,
    profitCents,
    inferenceCostCents,
    orderCount,
    costPerOrder,
    conversionByChannel,
    claimVerifiedRate: null, // computed by verify service
    policyBlocks: 0, // filled in by policy service at day-close
  };
}

export function writeRunMetrics(
  runId: string,
  metrics: DayMetrics,
  policyBlocks: number,
  claimVerifiedRate: number | null
): void {
  const db = getDb();
  db.insert(runMetrics)
    .values({
      runId,
      simDay: metrics.simDay,
      revenue: metrics.revenueCents,
      profit: metrics.profitCents,
      inferenceCost: metrics.inferenceCostCents,
      conversionByChannelJson: JSON.stringify(metrics.conversionByChannel),
      claimVerifiedRate,
      policyBlocks,
      costPerOrder: metrics.costPerOrder,
    })
    .onConflictDoNothing()
    .run();
}

export async function getRunSummary(runId: string): Promise<RunSummary> {
  const db = getDb();
  const rows = db
    .select()
    .from(runMetrics)
    .where(eq(runMetrics.runId, runId))
    .orderBy(runMetrics.simDay)
    .all();

  const days: DayMetrics[] = rows.map((r) => ({
    simDay: r.simDay,
    revenueCents: r.revenue,
    profitCents: r.profit,
    inferenceCostCents: r.inferenceCost,
    orderCount: 0,
    costPerOrder: r.costPerOrder,
    conversionByChannel: r.conversionByChannelJson
      ? JSON.parse(r.conversionByChannelJson)
      : {},
    claimVerifiedRate: r.claimVerifiedRate,
    policyBlocks: r.policyBlocks,
  }));

  const totalRevenueCents = days.reduce((s, d) => s + d.revenueCents, 0);
  const totalProfitCents = days.reduce((s, d) => s + d.profitCents, 0);
  const totalInferenceCostCents = days.reduce(
    (s, d) => s + d.inferenceCostCents,
    0
  );
  const totalOrders = days.reduce((s, d) => s + d.orderCount, 0);

  return {
    totalRevenueCents,
    totalProfitCents,
    totalInferenceCostCents,
    totalOrders,
    days,
  };
}
