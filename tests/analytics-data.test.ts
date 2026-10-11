import { describe, it, expect, beforeAll } from "vitest";
import { analyticsAgent } from "../src/agents/analytics.js";
import { getDb } from "../src/core/db.js";
import { sql } from "drizzle-orm";

const tool = (name: string) => analyticsAgent.tools.find((t) => t.name === name)!;
const ctx = { simDay: 1, agentRunId: "test" };

beforeAll(() => {
  const run = (q: string) => getDb().run(sql.raw(q));
  run(`INSERT OR IGNORE INTO channels (id, name) VALUES ('x', 'x')`);
  run(`INSERT INTO products (id, slug, type, title, description, price_cents, status) VALUES
        ('p-live', 'neatlogs', 'b2b', 'neatlogs', 'd', 0, 'live'),
        ('p-old', 'ai-rules-pack', 'digital', 'old', 'd', 900, 'retired')`);
  run(`INSERT INTO posts (id, channel_id, product_id, body, status, sim_day) VALUES
        ('post-live', 'x', 'p-live', 'live post', 'draft', 1),
        ('post-old', 'x', 'p-old', 'old post', 'published', 1),
        ('post-none', 'x', NULL, 'store-wide post', 'published', 1)`);
});

// trace e77bde38: every Analytics call re-read posts for retired products (ai-rules-pack, …)
describe("get_post_performance", () => {
  it("regression: leaves out posts for retired products", async () => {
    const rows = (await tool("get_post_performance").run({}, ctx)) as Array<{ id: string }>;
    expect(rows.map((r) => r.id).sort()).toEqual(["post-live", "post-none"]);
  });
});
