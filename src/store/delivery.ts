// Expiring download token management.
// Tokens are random UUIDs stored in the orders table; expiry checked against DB column.

import { randomUUID } from "crypto";
import { getDb } from "../core/db.js";
import { orders } from "../core/schema.js";
import { eq } from "drizzle-orm";

const TOKEN_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours

export function generateDownloadToken(orderId: string): {
  token: string;
  expiresAt: Date;
} {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  return { token, expiresAt };
}

export function getOrderByToken(token: string): typeof orders.$inferSelect | null {
  const db = getDb();
  return (
    db.select().from(orders).where(eq(orders.downloadToken, token)).get() ??
    null
  );
}
