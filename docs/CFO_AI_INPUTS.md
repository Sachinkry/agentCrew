# agentCrew: inputs for the cfo.ai business plan

Every cost number here was **measured** from real agent runs (`pnpm export:cfo` →
`runs/cfo_inputs.json`). Anything marked **assumed** is a planning choice; change it
in `src/eval/export_cfo.ts` and re-run the export.

## The business

agentCrew is a team of AI agents that runs the online sales and marketing work of a small B2B
company. An Operator agent checks in on a schedule, reads the store's state, and gives jobs
to three helpers:
- **Analytics:** sales, traffic and competitors (Crustdata).
- **Content:** listings, blog posts and social drafts, with claims checked against the product.
- **Support:** tickets.

Risky actions, such as publishing social posts or refunds, wait for the owner's approval.

Customers pay a monthly subscription. What they choose is how often the crew checks in.

## Measured unit cost (live, 2026-10-11)

| Metric | Value |
|---|---|
| Live check-ins (Operator + helpers) | 13 (1 failed, before the fixes) |
| Model | `deepseek/deepseek-v4.1-flash` via OpenRouter |
| **Cost per check-in** | **0.817¢** (OpenRouter `usage.cost`) |
| Tokens per check-in | 34,336 (cap: `RUN_TOKEN_BUDGET`) |
| Model calls per check-in | 10.8 |
| Duration per check-in | 67 s |
| Total model spend for the whole build-and-test period | **$0.106** |

Every check-in's token use is capped by a per-run budget. Spend is capped by
`LLM_BUDGET_CENTS`. So a customer's worst-case model cost is bounded by design, not
just estimated.

## Pricing and gross margin

| Tier | Price/mo | Check-ins/day | Inference/mo | Gross margin | Margin if the model costs 10x |
|---|---|---|---|---|---|
| Starter | $29 | 4 | $0.98 | 96.6% | 66.2% |
| Growth | $99 | 24 (hourly) | $5.88 | 94.1% | 40.6% |
| Scale | $299 | 96 (every 15 min) | $23.52 | 92.1% | 21.3% |

Prices and check-in frequencies are **assumed**. Inference per month is the measured
cost per check-in × check-ins per day × 30.

## Fixed monthly costs (assumed)

| Item | $/mo |
|---|---|
| Hosting (VM + backups) | 25 |
| Domain + email | 5 |
| Crustdata API (paid plan; currently the free sandbox) | 95, to confirm |
| Observability (neatlogs) | 0, to confirm the plan |
| **Total** | **125** |

To break even on fixed costs takes **5 Starter customers, or 2 on Growth**.

## Runway inputs (to set in cfo.ai)

- **Starting cash:** assumed **$1,000** (bootstrapped, solo founder, no salary in year 1).
- **Customer growth:** assumed 2 new paying customers in month 1, then +3 a month.
- **Mix:** assumed 60% Starter, 35% Growth, 5% Scale.
- **Churn:** assumed 5% a month.
- **Payment fees:** assumed 5% of revenue (merchant of record).

## Honest status

The demo store (which promotes neatlogs, where a "sale" is a click-through lead) had
63 real visits and **0 leads** so far. Social drafts are waiting for the owner's approval,
so nothing has been posted yet. **Revenue is $0.** The plan above is for selling the crew
as a product, not the demo store's own income.

## Prompt to paste into cfo.ai

> Build a 24-month business plan for agentCrew, a B2B SaaS where a team of AI agents runs
> sales and marketing for small companies.
>
> - **Pricing:** Starter $29/mo, Growth $99/mo, Scale $299/mo.
> - **Variable cost (measured):** $0.00817 of AI inference per agent check-in. Starter runs 4 check-ins a day, Growth 24, Scale 96. That is $0.98, $5.88 and $23.52 a month per customer.
> - **Payment fees:** 5% of revenue.
> - **Fixed costs:** $125/month (hosting $25, domain $5, data API $95).
> - **Customers:** start with $1,000 cash, no salaries; 2 new customers in month 1, then +3 a month; 60/35/5% tier mix; 5% monthly churn.
> - **Show:** monthly revenue, costs, gross margin, net income, cash balance and runway, and the break-even month.
> - **Sensitivity case:** AI cost per check-in 10x higher.
