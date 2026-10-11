import { describe, it, expect, beforeAll } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../src/core/db.js";
import { operatorAgent } from "../src/agents/operator.js";
import { contentAgent } from "../src/agents/content.js";

const ctx = { simDay: 1, agentRunId: "test" };
const run = (name: string, spec: { tools: { name: string; run: Function }[] }, input = {}) =>
  spec.tools.find((t) => t.name === name)!.run(input, ctx);

beforeAll(() => {
  const q = (s: string) => getDb().run(sql.raw(s));
  q(`INSERT OR IGNORE INTO channels (id, name) VALUES ('x', 'x')`);
  q(`INSERT INTO products (id, slug, type, title, description, price_cents, status) VALUES ('p1', 'neatlogs', 'b2b', 't', 'd', 0, 'live')`);
  q(`INSERT INTO posts (id, channel_id, product_id, body, status, sim_day) VALUES
      ('d1', 'x', 'p1', 'draft one', 'draft', 1),
      ('d2', 'x', 'p1', 'draft two', 'draft', 1),
      ('pub', 'x', 'p1', 'live one', 'published', 1)`);
});

// trace c76fe80a: the Operator kept asking Content to "publish the 4 X drafts", which only the owner can do
describe("drafts waiting for the owner are visible", () => {
  it("regression: operator snapshot counts posts awaiting owner approval", async () => {
    const snap = (await run("get_store_snapshot", operatorAgent)) as any;
    expect(snap.posts).toEqual({ published: 1, awaitingOwnerApproval: 2 });
  });
  it("regression: get_product lists the product's posts with who can act on them", async () => {
    const p = (await run("get_product", contentAgent, { slug: "neatlogs" })) as any;
    expect(p.posts).toEqual([
      { id: "d1", channel: "x", status: "awaiting owner approval" },
      { id: "d2", channel: "x", status: "awaiting owner approval" },
      { id: "pub", channel: "x", status: "published" },
    ]);
  });
});

// check-in 15: snapshot said 8 awaiting approval, Analytics saw 4 (it leaves out retired products)
describe("snapshot and analytics agree", () => {
  it("regression: snapshot leaves out posts for retired products", async () => {
    getDb().run(sql.raw(`INSERT INTO products (id, slug, type, title, description, price_cents, status) VALUES ('p-old', 'old', 'digital', 't', 'd', 900, 'retired')`));
    getDb().run(sql.raw(`INSERT INTO posts (id, channel_id, product_id, body, status, sim_day) VALUES ('old-draft', 'x', 'p-old', 'b', 'draft', 1)`));
    const snap = (await run("get_store_snapshot", operatorAgent)) as any;
    expect(snap.posts).toEqual({ published: 1, awaitingOwnerApproval: 2 });
  });
});
