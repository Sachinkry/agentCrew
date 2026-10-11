// Append-only money log. Profit = SUM(ledger). Never store profit as a mutable field.

import { randomUUID } from "crypto";
import { getDb } from "../core/db.js";
import { ledger } from "../core/schema.js";
import { eq, sql } from "drizzle-orm";

type LedgerKind = "revenue" | "cogs" | "inference" | "fee" | "refund";

interface LedgerEntry {
  simDay: number;
  kind: LedgerKind;
  amountCents: number; // positive = income, negative = cost
  refType?: string;
  refId?: string;
}

export function record(entry: LedgerEntry): string {
  const db = getDb();
  const id = randomUUID();
  db.insert(ledger).values({
    id,
    simDay: entry.simDay,
    kind: entry.kind,
    amountCents: entry.amountCents,
    refType: entry.refType ?? null,
    refId: entry.refId ?? null,
  }).run();
  return id;
}

export function recordRevenue(
  simDay: number,
  amountCents: number,
  orderId: string
) {
  return record({
    simDay,
    kind: "revenue",
    amountCents,
    refType: "order",
    refId: orderId,
  });
}

export function recordFee(
  simDay: number,
  feeCents: number,
  orderId: string
) {
  return record({
    simDay,
    kind: "fee",
    amountCents: -feeCents,
    refType: "order",
    refId: orderId,
  });
}

export function recordRefund(
  simDay: number,
  amountCents: number,
  orderId: string
) {
  return record({
    simDay,
    kind: "refund",
    amountCents: -amountCents,
    refType: "order",
    refId: orderId,
  });
}

export function totalProfit(runId?: string): number {
  const db = getDb();
  // Sum all ledger entries = profit (inference costs are already negative)
  const result = db
    .select({ total: sql<number>`SUM(amount_cents)` })
    .from(ledger)
    .get();
  return result?.total ?? 0;
}

export function profitByDay(simDay: number): number {
  const db = getDb();
  const result = db
    .select({ total: sql<number>`SUM(amount_cents)` })
    .from(ledger)
    .where(eq(ledger.simDay, simDay))
    .get();
  return result?.total ?? 0;
}

export function inferenceCostByDay(simDay: number): number {
  const db = getDb();
  const result = db
    .select({ total: sql<number>`SUM(amount_cents)` })
    .from(ledger)
    .where(eq(ledger.simDay, simDay))
    .get();
  // inference entries are negative; return absolute value
  const all = db
    .select({ total: sql<number>`SUM(ABS(amount_cents))` })
    .from(ledger)
    .where(
      sql`${ledger.simDay} = ${simDay} AND ${ledger.kind} = 'inference'`
    )
    .get();
  return all?.total ?? 0;
}

export function totalInferenceCost(): number {
  const db = getDb();
  const result = db
    .select({ total: sql<number>`SUM(ABS(amount_cents))` })
    .from(ledger)
    .where(eq(ledger.kind, "inference"))
    .get();
  return result?.total ?? 0;
}

export function revenueByDay(simDay: number): number {
  const db = getDb();
  const result = db
    .select({ total: sql<number>`SUM(amount_cents)` })
    .from(ledger)
    .where(
      sql`${ledger.simDay} = ${simDay} AND ${ledger.kind} = 'revenue'`
    )
    .get();
  return result?.total ?? 0;
}
