import { describe, it, expect, beforeAll } from "vitest";
import { contentAgent } from "../src/agents/content.js";
import { getDb, sqlAll } from "../src/core/db.js";
import { sql } from "drizzle-orm";

const tool = (name: string) => contentAgent.tools.find((t) => t.name === name)!;
const ctx = { simDay: 1, agentRunId: "test" };

beforeAll(() => {
  const run = (q: string) => getDb().run(sql.raw(q));
  run(`INSERT INTO products (id, slug, type, title, description, price_cents, status) VALUES
        ('p-nl', 'neatlogs', 'b2b', 'neatlogs', 'd', 9900, 'live')`);
  run(`INSERT INTO claims (id, product_id, text, verified, note) VALUES
        ('c1', 'p-nl', 'Free plan: 100k spans per month', 1, 'facts sheet')`);
});

// trace 85d8f765 (check-in 18): Content marked 3 new claims, incl. "Collaboration: …" that its new
// angle rests on. mark_claims only updated existing rows, dropped the new ones without a word and
// still answered {updated: 5, failed: []}.
describe("regression: mark_claims records new claims instead of dropping them", () => {
  it("adds a claim it hasn't seen and says so", async () => {
    const r = await tool("mark_claims").run(
      {
        slug: "neatlogs",
        verdicts: [
          { claim: "Free plan: 100k spans per month", verified: true, note: "facts sheet" },
          { claim: "Collaboration: support, product and engineering work from the same evidence", verified: true, note: "Facts sheet Features, verbatim." },
          { claim: "Used by 500 teams", verified: false, note: "not in the facts sheet" },
        ],
      },
      ctx
    );
    expect(r).toEqual({ updated: 1, added: 2, failed: ["Used by 500 teams"] });
    const rows = sqlAll<{ text: string; verified: number }>(
      `SELECT text, verified FROM claims WHERE product_id = 'p-nl' ORDER BY text`
    );
    expect(rows).toEqual([
      { text: "Collaboration: support, product and engineering work from the same evidence", verified: 1 },
      { text: "Free plan: 100k spans per month", verified: 1 },
      { text: "Used by 500 teams", verified: 0 },
    ]);
  });

  it("a failed new claim then blocks a listing that repeats it", async () => {
    await expect(
      tool("update_listing").run({ slug: "neatlogs", title: "t", description: "Used by 500 teams." }, ctx)
    ).rejects.toThrow(/Used by 500 teams/);
  });
});
