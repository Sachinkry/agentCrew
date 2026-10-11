# AutoShelf — Agent Handoff Doc

**Project:** AutoShelf — autonomous digital-goods store  
**Hackathon:** neatHack, submission deadline Mon Oct 12 11:55 PM IST  
**Repo:** /Users/sachinkumaryadav/code-sac/neathack-gum  
**Stack:** TypeScript + Node 20 + tsx, SQLite/Drizzle, Hono, Claude via Bedrock  

---

## What's built (session 1)

### Core layer — COMPLETE
- `src/core/schema.ts` — full SQLite schema (all tables per spec)
- `src/core/db.ts` — Drizzle wrapper, WAL mode, foreign keys
- `src/core/config.ts` — zod-validated config from env
- `src/core/llm.ts` — Bedrock client + MOCK_LLM=1 + auto cost→ledger + zod-retry
- `src/core/trace.ts` — neatlogs wrapper with offline fallback

### Services — COMPLETE
- `src/services/ledger.ts` — append-only money log (profit = SUM)
- `src/services/policy.ts` — all guardrails: price floor, max discount, refund limit, spend cap, unverified listing gate. Block counter per day.
- `src/services/metrics.ts` — read-only views, `writeRunMetrics`
- `src/services/approvals.ts` — queue with AUTO_APPROVE_DEMO=1 mode
- `src/services/verify.ts` — `verifyClaims()` — LLM-based per-claim pass/fail, updates DB

### Agents — COMPLETE (logic; LLM prompts wired)
- `src/agents/content.ts` — `publishListing`, `draftPost`, `createLandingPage`, `runTask`
- `src/agents/support.ts` — `handleTicket`, `handleAllOpenTickets`
- `src/agents/analytics.ts` — `funnelReport`, `scoreExperiment`, `runDiagnosis`
- `src/agents/operator.ts` — `operatorTick`, action executor, auto-revert experiments

### Simulator — COMPLETE
- `src/sim/clock.ts` — seeded day counter
- `src/sim/personas.ts` — 6 buyer personas
- `src/sim/traffic.ts` — `mulberry32` PRNG, purchase probability model, ticket generation
- `src/sim/inject.ts` — failure injection flags
- `src/sim/run.ts` — CLI runner (seeds products, runs N days)

### Storefront — COMPLETE
- `src/store/index.ts` — Hono routes: `/`, `/p/:slug`, `/checkout/:productId`, `/checkout/success`, `/webhook/dodo`, `/download/:token`
- `src/store/payments.ts` — Dodo Payments integration + mock mode
- `src/store/delivery.ts` — signed expiring download tokens

### Artifacts — 3 products seeded
- `artifacts/freelancer-budget-tracker/` — xlsx build script + README + claims
- `artifacts/ai-rules-pack/` — CLAUDE.md + cursor-rules-react.md + cursor-rules-python-api.md
- `artifacts/prompt-pack-recruiters/` — 25 recruiter prompts

### Eval — COMPLETE
- `src/eval/compare.ts` — before/after markdown table from two run IDs
- `src/eval/export_cfo.ts` — CSV + JSON export for cfo.ai

### Tests — PARTIAL
- `tests/policy.test.ts` — full policy guardrail tests ✓
- `tests/ledger.test.ts` — basic smoke tests
- `tests/sim-determinism.test.ts` — PRNG determinism ✓

### Configs
- `configs/baseline.json` — clean run, no injection
- `configs/fixed.json` — same as baseline (guardrails active)
- `configs/failures.json` — all 4 failures injected

---

## What's NOT done yet (priority order)

### P0 — Must have to demo
1. **DB migrations** — `pnpm db:push` must run against the SQLite schema. Need to test end-to-end: `pnpm db:push && MOCK_LLM=1 pnpm sim --seed 42 --days 5`
2. **`artifacts/freelancer-budget-tracker/freelancer-budget-tracker.xlsx`** — run `pnpm tsx artifacts/freelancer-budget-tracker/build.ts` to generate the actual xlsx file
3. **MOCK_LLM canned responses** — `src/core/llm.ts` has an `addMockOutput` map but the operator/analytics agents need realistic mock JSON responses that match their zod schemas. Without this, `MOCK_LLM=1 pnpm sim` will throw on JSON.parse of "{"ok":true,"mock":true}". Fix: expand `MOCK_OUTPUTS` in llm.ts with per-agent canned schema-valid responses, OR make the LLM mock smarter (detect schema from agent name).
4. **`verifyWebhookSignature` async issue** — `src/store/payments.ts:72` uses `await import("crypto")` inside a non-async function. Fix: import crypto at top of file.
5. **`analytics.ts` syntax error** — line in `retireList` array uses `;` instead of `,` in the object type: `z.object({ productId: z.string(); reason: z.string() })`. Fix: change `;` to `,`.

### P1 — Demo quality
6. **`docs/ARCHITECTURE.md`** — ASCII/mermaid diagram
7. **`docs/ASSUMPTIONS.md`** — decisions and limitations
8. **`docs/DEMO_SCRIPT.md`** — 3-min demo script
9. **`docs/CFO_AI_INPUTS.md`** — business model inputs for cfo.ai
10. **`docs/X_POSTS.md`** — 4 draft X posts
11. **`README.md`** — setup, architecture, results table, disclosure

### P2 — Nice to have
12. Full drizzle migrations (currently schema-only, no migration files generated)
13. `vitest.config.ts` with in-memory SQLite so policy/ledger tests work without real DB
14. End-to-end test: seed → 30-day sim → eval:compare baseline vs failures
15. Evidence screenshots in `docs/evidence/`

---

## How to pick up

```bash
cd /Users/sachinkumaryadav/code-sac/neathack-gum

# 1. Fix the syntax error in analytics.ts (semicolon → comma, line ~100 retireList type)
# 2. Fix verifyWebhookSignature in payments.ts (add import crypto at top)
# 3. Generate the xlsx
pnpm tsx artifacts/freelancer-budget-tracker/build.ts

# 4. Run DB migration
pnpm db:push

# 5. Test sim runs (will fail on LLM parse until mock outputs fixed)
MOCK_LLM=1 AUTO_APPROVE_DEMO=1 DATABASE_URL=./runs/test.sqlite pnpm sim --seed 42 --days 3

# 6. Run tests
pnpm test
```

## Key decisions / assumptions
- No email channel (cut for time) — web + X only
- Analytics scraping cut; market_signals seeded by hand via Operator tasks
- neatlogs: HTTP flush implemented but falls back to console when NEATLOGS_API_KEY absent — full offline mode works
- Dodo Payments: mock mode returns a redirect URL to `/checkout/success?mock=1` which creates an order directly
- Entire checkpoints: not yet wired — add after first successful sim run
- LLM cost model: approximated from Bedrock pricing, good enough for demo

## Critical files to read before editing
- `src/core/llm.ts` — understand mock mode before touching agent code
- `src/services/policy.ts` — all guardrails here; F1-F4 demo depends on this
- `src/sim/run.ts` — entry point; seeds products; understand before changing product catalog
- `src/agents/operator.ts` — references analytics and content; change carefully

## Env for local dev (all mock, no AWS needed)
```
MOCK_LLM=1
AUTO_APPROVE_DEMO=1
DATABASE_URL=./runs/dev.sqlite
DAILY_SPEND_CAP_CENTS=5000
PLATFORM_FEE_PCT=10
SIM_SEED=42
```
