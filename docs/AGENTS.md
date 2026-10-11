# AutoShelf — Agent Handoff Doc

**Project:** AutoShelf — autonomous digital-goods store  
**Hackathon:** neatHack, submission deadline Mon Oct 12 11:55 PM IST  
**Repo:** /Users/sachinkumaryadav/code-sac/neathack-gum  
**Stack:** TypeScript + Node 20 + tsx, SQLite/Drizzle, Hono + React SSR (shadcn/Tailwind), open-weight models (DeepSeek / GLM) via OpenRouter, neatlogs tracing  

---

## What's built (session 1)

### Core layer — COMPLETE
- `src/core/schema.ts` — full SQLite schema (all tables per spec)
- `src/core/db.ts` — Drizzle wrapper, WAL mode, foreign keys
- `src/core/config.ts` — zod-validated config from env
- `src/core/model.ts` — OpenRouter chat client (LLM spans with thinking → neatlogs)
- `src/core/llm.ts` — single-shot calls + MOCK_LLM=1 + auto cost→ledger + zod-retry
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

## Refined plan (session 2 audit, Oct 11 evening; deadline Oct 12 11:55 PM IST)

Scoring weights: autonomy 30% · neatlogs/Entire/cfo.ai 25% · demo video 20% · building in public 15% · usefulness 10%.
Order work by points, not by architecture completeness.

### Audit: what's actually true right now
- Fixed already: the analytics `;` typo and the payments `await import("crypto")` bug are both gone. `src/` typechecks clean.
- **Blocker:** better-sqlite3 11.x doesn't build on Node 24, so every test and the sim crash on load. Fix verified in isolation: `better-sqlite3@^12` works on Node 24.6.
- **The failure-injection story isn't wired.** `src/sim/inject.ts` exports `shouldSkipVerifyGate`, `shouldSkipPriceFloor`, `getMinSampleOverride` and `getRefundAmountOverride`, but nothing calls them.
- **`--config` is ignored.** `run.ts` never calls `loadConfigFile`, so baseline, failures and fixed all run identically. The before/after table would show zero difference.
- **The mock LLM shows no autonomy.** The operator always returns `noop`, verify returns `results: []`, and mock cost is 0. In mock mode the agents never decide anything, and "profit after inference" equals plain profit.
- **The real LLM path can't run.** `llm.ts` dynamically imports `@aws-sdk/client-bedrock-runtime`, which isn't installed. `@ai-sdk/amazon-bedrock` is installed but unused.
- **neatlogs is a stub.** `trace.ts` POSTs to an invented URL. A real `neatlogs` npm package exists (v1.1.28). neatlogs ingests OpenTelemetry over OTLP/HTTP, which is the fallback if the JS SDK is awkward.
- **Entire CLI isn't installed** and isn't enabled on this repo.
- `tsconfig.json` has `rootDir: src` but includes `tests/`, so `tsc` errors (TS6059).

### Phase 0: unblock (≈1h)
1. `pnpm add better-sqlite3@^12`, then `pnpm test`.
2. tsconfig: drop `rootDir` (or keep it and exclude tests from tsc).
3. `pnpm add @aws-sdk/client-bedrock-runtime` and `pnpm remove @ai-sdk/amazon-bedrock`. The code already uses the AWS SDK.
4. `run.ts`: parse `--config` and merge `loadConfigFile()` into `config` before anything reads it.
5. `pnpm db:push`, then `pnpm tsx artifacts/freelancer-budget-tracker/build.ts`.
6. `MOCK_LLM=1 AUTO_APPROVE_DEMO=1 pnpm sim --seed 42 --days 5` should complete without errors.
7. **Install Entire now** (`entire enable` in this repo). Every commit from here on gets a checkpoint, and checkpoints can't be created after the fact.

### Phase 1: make the before/after story real (≈4h, autonomy 30%)
1. Wire the injections:
   - `verify.ts` and `content.publishListing` → `shouldSkipVerifyGate` (F1, unverified claim).
   - `support.ts` → `getRefundAmountOverride` (F2, angry refund).
   - `policy.ts` price floor → `shouldSkipPriceFloor` (F3, negative-margin discount).
   - `operator.ts` sample-size gate → `getMinSampleOverride` (F4, thin-data rotation).
2. Replace the static mocks with a **deterministic, metrics-aware mock policy**. The prompt already includes the metrics JSON, so parse `userMessage`:
   - Operator: low conversion → `rewrite_listing`/`draft_post`; high traffic and low conversion → `discount` experiment; any channel with fewer than N sessions → `rotate` (only allowed when F4 is injected).
   - Verify: fail any claim that doesn't appear in the artifact text, e.g. by numeric mismatch.
   - Support: an angry ticket proposes a full refund.
   - Non-zero mock token costs, scaled by tier.
3. Run three 30-day sims (baseline, failures, fixed) and get `eval:compare` to show clear deltas. The deltas to show are policy blocks, profit, refunds paid, unverified listings and margin. That table is the headline of the README and the video.
4. Add a vitest per failure mode that asserts guardrail ON blocks and OFF leaks.

### Phase 2: sponsor tools (≈3h, 25%)
1. **neatlogs:** read the `neatlogs` npm README and swap `trace.ts` onto it (fallback: OTel SDK + OTLP exporter). Make sure agent→tool→LLM spans nest, and tag them with run_id, sim_day and policy-block events. Do a short real-Bedrock run (3 days) so traces have real tokens and cost. Screenshot the trace tree for F1–F4.
2. **Entire:** enabled from Phase 0. In the README, link the `entire/checkpoints/v1` branch and one checkpoint showing an agent session that fixed a guardrail.
3. **cfo.ai:** `pnpm export:cfo <fixed_run_id>`, then load it into cfo.ai and build the unit-economics model: price, platform fee, inference cost per order, refund rate. Screenshot it, and write `docs/CFO_AI_INPUTS.md` with the numbers *from the run*, not invented ones.

### Phase 3: make autonomy visible (≈2–3h)
1. Add an `/ops` page to the Hono app that reads from SQLite (no new deps): a daily P&L chart from the ledger, the operator decision log (action + `metric_cited` + reasoning), policy blocks with reasons, and experiment states. This page is what the video shows.
2. Make the storefront real: one live product, Dodo test-mode checkout → webhook → download link. A real test purchase on camera is worth more than another sim day.

### Phase 4: ship (≈3h, 20% + 15%)
1. README: one-paragraph pitch, architecture mermaid diagram, results table, how to run (`MOCK_LLM=1` path in 3 commands), AI disclosure.
2. `docs/DEMO_SCRIPT.md`, ≤3 min: problem (0:00–0:20) → store live and a real purchase (0:20–0:50) → 30-day sim with failures injected and things going wrong (0:50–1:30) → same seed with guardrails, neatlogs trace of the block (1:30–2:20) → results table, cfo.ai model, Entire checkpoints (2:20–3:00).
3. **Build in public, starting now, not at the end:** post 1 tonight (what we're building plus the architecture), post 2 when the sim first runs, post 3 with the neatlogs trace of a blocked bad refund, post 4 at launch with the video. Keep drafts in `docs/X_POSTS.md`.
4. Record the video by Oct 12 ~8 PM IST. Leave 4h of buffer before 11:55 PM.

### Cut / don't do
Email channel, market scraping, landing-page generation, ESLint setup, drizzle migration files (`db:push` is enough), multiple real LLM runs (one short real run for traces only).

### Suggested timeline (IST)
- Oct 11, to 23:00: Phase 0, plus X post 1.
- Oct 12, 09:00–13:00: Phase 1.
- 13:00–16:00: Phase 2.
- 16:00–18:30: Phase 3.
- 18:30–21:00: Phase 4 and video.
- 21:00–23:55: buffer and submission.

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
