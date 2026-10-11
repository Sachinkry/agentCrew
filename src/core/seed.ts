// Seeds channels and the starter products. Safe to run repeatedly.

import { randomUUID } from "crypto";
import { getDb } from "./db.js";
import { and, eq, inArray } from "drizzle-orm";
import { config } from "./config.js";
import { channels, claims, products } from "./schema.js";

export function seedStore() {
  const db0 = getDb();
  for (const name of ["web", "x", "blog"] as const) {
    db0.insert(channels).values({ id: `channel_${name}`, name }).onConflictDoNothing().run();
  }

  const db = getDb();

  // B2B tools from neatHack sponsors. Claims come from each vendor's public site
  // (see artifacts/<slug>/facts.md); the Content agent re-checks them before use.
  const seedData = [
    {
      id: "prod_neatlogs",
      slug: "neatlogs",
      type: "observability" as const,
      vendor: "neatlogs",
      title: "neatlogs — find why your AI agents fail, and the fix",
      description:
        "Traces, failure detection, root-cause investigations and evals for teams shipping AI agents. Free plan included; paid plans from $99/month.",
      priceCents: 9900,
      priceLabel: "Free · from $99/mo",
      ctaUrl: "https://app.neatlogs.com",
      costCentsEst: 0,
      artifactPath: "artifacts/neatlogs",
      claims: [
        "Free plan: 100k spans per month",
        "Investigations give root cause and a fix brief a coding agent can ship",
        "Evals score every run against what good looks like",
        "SDKs for Python, TypeScript and Go",
        "Starter plan from $99/month with first month free",
      ],
    },
    {
      id: "prod_entire",
      slug: "entire",
      type: "dev_tool" as const,
      vendor: "Entire",
      title: "Entire — every agent session stored in your repo",
      description:
        "Git hosting and an open-source CLI that save each AI agent session, prompt and tool call alongside your commits, so you can review the intent, not just the code.",
      priceCents: 0,
      priceLabel: "Free CLI",
      ctaUrl: "https://entire.io/login",
      costCentsEst: 0,
      artifactPath: "artifacts/entire",
      claims: [
        "A checkpoint for every commit, linked to the agent session that produced it",
        "Secrets are detected and redacted before anything is stored",
        "Works with Claude Code, Codex, Gemini, Cursor and GitHub Copilot",
        "Open-source CLI (MIT licensed)",
        "In-region hosting in India, Australia, the EU and the US",
      ],
    },
    {
      id: "prod_crustdata",
      slug: "crustdata",
      type: "data_api" as const,
      vendor: "Crustdata",
      title: "Crustdata — real-time people and company data for AI agents",
      description:
        "Search, enrich and watch B2B people and company data through a REST API or MCP server. Built for AI SDRs, recruiting platforms and deal sourcing.",
      priceCents: 0,
      priceLabel: "Free sandbox key",
      ctaUrl: "https://app.crustdata.com/auth/login",
      costCentsEst: 0,
      artifactPath: "artifacts/crustdata",
      claims: [
        "People and company data via REST API or MCP server",
        "Search, Enrich and Watch APIs",
        "Covers 1B+ people",
        "Jobs and Posts APIs",
        "Free sandbox API key for developers",
      ],
    },
  ];

  // Only the focus products are live; the other B2B listings wait as drafts.
  for (const p of seedData) {
    const status = config.focusProducts.includes(p.slug) ? "live" : "draft";
    db.update(products).set({ status }).where(and(eq(products.id, p.id), inArray(products.status, ["live", "draft"]))).run();
  }

  // The earlier digital products are retired (kept for past orders, hidden from the store).
  for (const id of ["prod_spreadsheet_1", "prod_rules_1", "prod_prompts_1"]) {
    db.update(products).set({ status: "retired" }).where(and(eq(products.id, id), eq(products.status, "live"))).run();
  }

  for (const p of seedData) {
    const { claims: productClaims, ...productData } = p;
    const inserted = db.insert(products).values({ ...productData, status: config.focusProducts.includes(p.slug) ? "live" : "draft" }).onConflictDoNothing().run();
    if (inserted.changes === 0) continue;

    for (const claimText of productClaims) {
      db.insert(claims)
        .values({
          id: randomUUID(),
          productId: p.id,
          text: claimText,
          verified: null,
        })
        .onConflictDoNothing()
        .run();
    }
  }
}

