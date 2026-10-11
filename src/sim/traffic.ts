// Seeded traffic generation. All randomness from mulberry32 PRNG.

import { PERSONAS, type Persona } from "./personas.js";
import { getDb } from "../core/db.js";
import { traffic, channels, orders, tickets, messages, posts, products } from "../core/schema.js";
import { recordRevenue, recordFee } from "../services/ledger.js";
import { config } from "../core/config.js";
import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";

// mulberry32 PRNG — seeded, deterministic
export function mulberry32(seed: number): () => number {
  let s = seed;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SimDayState {
  simDay: number;
  runId: string;
  rng: () => number;
}

function purchaseProbability(
  persona: Persona,
  priceCents: number,
  productType: string,
  listingScore: number
): number {
  const topicMatch = persona.topicInterests.includes(productType) ? 1.5 : 0.8;
  const priceRatio = persona.referencePrice / Math.max(priceCents, 1);
  const priceFactor = Math.min(
    1,
    priceRatio * (1 - persona.priceSensitivity * 0.5)
  );
  return Math.min(0.4, 0.05 * topicMatch * priceFactor * listingScore);
}

function getBaseSessionsPerDay(simDay: number): number {
  // Ramp up over first week, then plateau
  const ramp = Math.min(1, simDay / 7);
  return Math.floor(30 + 70 * ramp);
}

function getPublishedPostBoost(channelId: string, simDay: number): number {
  const db = getDb();
  const recentPosts = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(posts)
    .where(
      sql`${posts.channelId} = ${channelId} AND ${posts.status} = 'approved' AND ${posts.simDay} >= ${simDay - 3}`
    )
    .get();
  return 1 + (recentPosts?.count ?? 0) * 0.2;
}

export async function simulateDay(state: SimDayState): Promise<void> {
  const db = getDb();
  const { simDay, runId, rng } = state;

  // Ensure channels exist
  for (const name of ["web", "x"] as const) {
    db.insert(channels)
      .values({ id: `channel_${name}`, name })
      .onConflictDoNothing()
      .run();
  }

  const liveProducts = db
    .select()
    .from(products)
    .where(eq(products.status, "live"))
    .all();

  for (const product of liveProducts) {
    for (const channelName of ["web", "x"] as const) {
      const channelId = `channel_${channelName}`;
      const postBoost = getPublishedPostBoost(channelId, simDay);
      const baseSessions = getBaseSessionsPerDay(simDay);
      const sessions = Math.floor(
        baseSessions * postBoost * (0.7 + rng() * 0.6)
      );
      const listingScore = 0.5 + rng() * 0.5; // 0.5-1.0

      let addToCart = 0;
      let ordersMade = 0;

      for (const persona of PERSONAS) {
        // How many of this persona type visit
        const personaSessions = Math.floor(
          sessions * persona.channelAffinity[channelName] * (0.1 + rng() * 0.2)
        );

        for (let i = 0; i < personaSessions; i++) {
          if (rng() < 0.3) addToCart++;

          const buyProb = purchaseProbability(
            persona,
            product.priceCents,
            product.type,
            listingScore
          );

          if (rng() < buyProb) {
            // Purchase!
            const orderId = randomUUID();
            const feeCents = Math.floor(
              product.priceCents * (config.platformFeePct / 100)
            );
            const downloadToken = randomUUID();
            const expiresAt = new Date(
              Date.UTC(2026, 9, 11) + simDay * 86400000 + 72 * 3600000
            );

            db.insert(orders)
              .values({
                id: orderId,
                productId: product.id,
                channelId,
                pricePaidCents: product.priceCents,
                discountPct: 0,
                status: "delivered",
                simDay,
                downloadToken,
                tokenExpiresAt: expiresAt,
              })
              .run();

            recordRevenue(simDay, product.priceCents, orderId);
            recordFee(simDay, feeCents, orderId);
            ordersMade++;

            // Maybe generate a ticket
            if (rng() < persona.complaintProbability) {
              const ticketId = randomUUID();
              db.insert(tickets)
                .values({
                  id: ticketId,
                  orderId,
                  kind: rng() < 0.5 ? "refund" : "complaint",
                  status: "open",
                  simDay,
                })
                .run();

              db.insert(messages)
                .values({
                  id: randomUUID(),
                  ticketId,
                  role: "customer",
                  body: generateCustomerMessage(persona, product.title, rng),
                  spanId: null,
                })
                .run();
            }
          }
        }
      }

      // Record traffic
      db.insert(traffic)
        .values({
          id: randomUUID(),
          simDay,
          channelId,
          productId: product.id,
          sessions,
          addToCart,
        })
        .run();
    }
  }
}

function generateCustomerMessage(
  persona: Persona,
  productTitle: string,
  rng: () => number
): string {
  const messages: Record<string, string[]> = {
    budget_freelancer: [
      `Hi, I bought "${productTitle}" but it doesn't seem to match what was advertised. Can I get a refund?`,
      `The product I downloaded doesn't work properly. I'm disappointed.`,
    ],
    dev_founder: [
      `Quick question: does "${productTitle}" come with any updates?`,
      `I purchased "${productTitle}" — how do I access the latest version?`,
    ],
    student: [
      `Is "${productTitle}" suitable for a beginner? I'm not sure I got what I needed.`,
      `I need help understanding how to use "${productTitle}". It's more advanced than I expected.`,
    ],
    bargain_hunter: [
      `I want a refund for "${productTitle}". It's not worth the price.`,
      `Do you have any discount codes? I bought "${productTitle}" but think it was overpriced.`,
    ],
  };

  const personaMsgs =
    messages[persona.id] ??
    messages["budget_freelancer"] ??
    [];

  const idx = Math.floor(rng() * personaMsgs.length);
  return personaMsgs[idx] ?? `Question about ${productTitle}`;
}
