// Main simulation runner.
// Usage: pnpm sim --seed 42 --days 30 --config configs/baseline.json

import { getDb } from "../core/db.js";
import { runs, channels, products, claims } from "../core/schema.js";
import { config } from "../core/config.js";
import { simulateDay, mulberry32 } from "./traffic.js";
import { setDay, advanceDay } from "./clock.js";
import { operatorTick } from "../agents/operator.js";
import { handleAllOpenTickets } from "../agents/support.js";
import { startRootSpan, endSpan } from "../core/trace.js";
import { randomUUID } from "crypto";
import { execSync } from "child_process";

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? (args[idx + 1] ?? fallback) : fallback;
}

const seed = parseInt(getArg("seed", String(config.simSeed)));
const days = parseInt(getArg("days", String(config.simDays)));

async function main() {
  const runId = randomUUID();
  let gitSha = "unknown";
  try {
    gitSha = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    // Not a git repo or no commits yet
  }

  const rootSpan = startRootSpan("sim:run", {
    run_id: runId,
    seed,
    days,
    mock_llm: config.mockLlm ? 1 : 0,
  });

  const db = getDb();

  // Record run
  db.insert(runs).values({
    id: runId,
    seed,
    gitSha,
    configJson: JSON.stringify(config),
    traceRoot: rootSpan.id,
  }).run();

  // Seed channels
  for (const name of ["web", "x"] as const) {
    db.insert(channels)
      .values({ id: `channel_${name}`, name })
      .onConflictDoNothing()
      .run();
  }

  // Seed products (first run — idempotent)
  await seedProducts();

  const rng = mulberry32(seed);

  console.log(`\n[sim] Starting run ${runId} | seed=${seed} | days=${days} | mock=${config.mockLlm}\n`);

  for (let day = 1; day <= days; day++) {
    setDay(day);
    console.log(`\n──────── Day ${day}/${days} ────────`);

    // 1. Generate traffic and purchases
    await simulateDay({ simDay: day, runId, rng });

    // 2. Handle support tickets
    await handleAllOpenTickets({ runId, simDay: day });

    // 3. Operator tick (reads metrics, delegates tasks, runs experiments)
    await operatorTick(day, runId);

    advanceDay();
  }

  await endSpan(rootSpan);
  console.log(`\n[sim] Run complete. ID: ${runId}`);
  console.log(`[sim] To evaluate: pnpm eval:compare ${runId} <other_run_id>`);
}

async function seedProducts() {
  const db = getDb();

  const seedData = [
    {
      id: "prod_spreadsheet_1",
      slug: "freelancer-budget-tracker",
      type: "spreadsheet" as const,
      title: "Freelancer Budget & Invoice Tracker",
      description:
        "A complete Excel/Google Sheets financial toolkit for freelancers — 12 monthly tabs, invoice generator, tax estimator, and runway calculator.",
      priceCents: 1900,
      costCentsEst: 0,
      artifactPath: "artifacts/freelancer-budget-tracker",
      claims: [
        "12 monthly tracking tabs (Jan-Dec)",
        "50 income rows per month",
        "20 expense categories",
        "Invoice auto-numbering (INV-001 format)",
        "Quarterly tax estimate calculator",
        "Zero formula errors on sample data",
        "Works in Excel and Google Sheets",
      ],
    },
    {
      id: "prod_rules_1",
      slug: "ai-rules-pack",
      type: "rules_pack" as const,
      title: "AI Coding Rules Pack — CLAUDE.md + Cursor Rules",
      description:
        "Production-ready CLAUDE.md and Cursor rules for TypeScript/Node.js and React/Next.js stacks. Drop in and start shipping faster.",
      priceCents: 1200,
      costCentsEst: 0,
      artifactPath: "artifacts/ai-rules-pack",
      claims: [
        "CLAUDE.md for TypeScript/Node.js stack",
        "Cursor rules for React/Next.js",
        "Cursor rules for Python FastAPI",
        "Covers testing, error handling, LLM patterns",
        "Immediately usable — drop into any project",
      ],
    },
    {
      id: "prod_prompts_1",
      slug: "prompt-pack-recruiters",
      type: "prompt_pack" as const,
      title: "AI Prompt Pack for Recruiters — 25 Ready-to-Use Prompts",
      description:
        "25 battle-tested AI prompts for recruiters: job descriptions, candidate outreach, interviews, offer negotiations, and rejection emails.",
      priceCents: 1500,
      costCentsEst: 0,
      artifactPath: "artifacts/prompt-pack-recruiters",
      claims: [
        "25 ready-to-use prompts",
        "Covers 8 recruiting workflows",
        "Prompts for JDs, outreach, interviews, offers",
        "Works with ChatGPT, Claude, and Gemini",
        "Includes sample outputs for each prompt",
      ],
    },
  ];

  for (const p of seedData) {
    const { claims: productClaims, ...productData } = p;
    db.insert(products).values({ ...productData, status: "live" }).onConflictDoNothing().run();

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

main().catch((err) => {
  console.error("[sim] Fatal error:", err);
  process.exit(1);
});
