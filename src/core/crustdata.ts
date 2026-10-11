// Crustdata API client (company data) for competitor research.
// Responses are cached for 7 days in crustdata_cache so repeat runs don't spend credits again.
// Docs: https://docs.crustdata.com/openapi-specs/2025-11-01/introduction

import { createHash } from "crypto";
import { eq } from "drizzle-orm";
import { config } from "./config.js";
import { getDb } from "./db.js";
import { crustdataCache } from "./schema.js";

const BASE_URL = "https://api.crustdata.com";
const API_VERSION = "2025-11-01";
const CACHE_MS = 7 * 24 * 60 * 60 * 1000;

export async function crustdata<T = unknown>(path: string, body: unknown): Promise<{ data: T; credits: number; cached: boolean }> {
  const key = createHash("sha256").update(path + JSON.stringify(body)).digest("hex");
  const db = getDb();
  const hit = db.select().from(crustdataCache).where(eq(crustdataCache.key, key)).get();
  if (hit && Date.now() - hit.fetchedAt.getTime() < CACHE_MS) {
    return { data: JSON.parse(hit.response) as T, credits: 0, cached: true };
  }
  if (!config.crustdataApiKey) throw new Error("CRUSTDATA_API_KEY is not set (see .env.example)");

  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.crustdataApiKey}`,
      "content-type": "application/json",
      "x-api-version": API_VERSION,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try {
      const j = JSON.parse(text);
      detail = `${j.error ?? ""} ${j.description ?? j.reason ?? ""}`.trim();
    } catch {
      // not JSON
    }
    throw new Error(`Crustdata ${res.status} on ${path}: ${detail}`);
  }
  const credits = Number(res.headers.get("x-credits-used") ?? 0);
  db.insert(crustdataCache)
    .values({ key, response: text, credits, fetchedAt: new Date() })
    .onConflictDoUpdate({ target: crustdataCache.key, set: { response: text, credits, fetchedAt: new Date() } })
    .run();
  return { data: JSON.parse(text) as T, credits, cached: false };
}

/** Credits spent on Crustdata so far (from cached responses). */
export function crustdataCreditsUsed(): number {
  return getDb().select().from(crustdataCache).all().reduce((n, r) => n + (r.credits ?? 0), 0);
}
