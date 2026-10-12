// Operator agent: the manager. Looks at the store, decides what to do next, and
// hands work to the Analytics, Content and Support agents (each runs as a tool,
// so their traces nest under the operator's).

import { eq } from "drizzle-orm";
import { loadPrompt, runAgent, lastResult, type AgentSpec, type AgentTool } from "../core/agent.js";
import { getDb, sqlAll } from "../core/db.js";
import { config } from "../core/config.js";
import { askAnalytics } from "./analytics.js";
import { assignContent } from "./content.js";
import { runSupport } from "./support.js";
import { withTokenBudget, withGrant, grantPool, tokensLeft, BudgetRefused } from "../core/budget.js";
import { agentRuns } from "../core/schema.js";

const tools: AgentTool[] = [
  {
    name: "get_store_snapshot",
    readOnly: true,
    description: "Quick overview: live products with leads so far, money, open tickets, and posts (published / awaiting the owner's approval).",
    input_schema: { type: "object", properties: {} },
    run: async () => ({
      products: sqlAll(`SELECT p.slug, p.title, p.price_label, p.version,
          (SELECT COUNT(*) FROM leads l WHERE l.product_id = p.id) AS leads
        FROM products p WHERE p.status = 'live'`),
      money: sqlAll(`SELECT kind, SUM(amount_cents) AS cents FROM ledger GROUP BY kind`),
      openTickets: sqlAll<{ n: number }>(`SELECT COUNT(*) AS n FROM tickets WHERE status='open'`)[0]?.n ?? 0,
      // Drafts wait for the store owner's approval; no agent can publish them.
      posts: sqlAll<{ published: number; awaitingOwnerApproval: number }>(
        `SELECT COUNT(CASE WHEN po.status = 'published' THEN 1 END) AS published,
                COUNT(CASE WHEN po.status = 'draft' THEN 1 END) AS awaitingOwnerApproval
         FROM posts po LEFT JOIN products p ON p.id = po.product_id
         WHERE po.product_id IS NULL OR p.status = 'live'`
      )[0],
    }),
  },
  {
    name: "ask_analytics",
    description: "Ask the Analytics agent a question about sales, traffic sources, posts or AI cost. Returns its answer.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string" },

      },
      required: ["question"],
    },
    run: ({ question }, ctx) =>
      delegate("analytics", () =>
        askAnalytics(String(question), { ...opts(ctx), parentId: ctx.agentRunId })
      ),
  },
  {
    name: "assign_content",
    description:
      "Give the Content agent a job for one product: fix/improve its listing, draft promo posts, and/or write and publish a blog post on /blog promoting it. Say which product (slug) and what you want.",
    input_schema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        instructions: { type: "string" },

      },
      required: ["slug", "instructions"],
    },
    run: ({ slug, instructions }, ctx) =>
      delegate("content", () =>
        assignContent(`Product: ${slug}\n${instructions}`, { ...opts(ctx), parentId: ctx.agentRunId })
      ),
  },
  {
    name: "run_support",
    description: "Have the Support agent work through open customer tickets.",
    input_schema: {
      type: "object",
      properties: {

      },
    },
    run: (_input, ctx) =>
      delegate("support", () => runSupport({ ...opts(ctx), parentId: ctx.agentRunId })),
  },
];

// Hand a job to a helper inside its own token grant, sized by GRANT_POLICY (see budget.ts). A refused job
// comes back to the operator as a tool error so it can pick something smaller.
export async function delegate(
  agent: string,
  job: () => Promise<{ agentRunId: string; answer: string }>
) {
  try {
    const { result, granted, used } = await withGrant(agent, undefined, job);
    return {
      agentRunId: result.agentRunId,
      answer: result.answer,
      tokens: { granted, used, runLeft: tokensLeft("operator"), freeForJobs: grantPool() },
    };
  } catch (err) {
    if (err instanceof BudgetRefused) throw new Error(`NOT RUN: ${err.message}`);
    throw err;
  }
}

function opts(ctx: { runId?: string | undefined; simDay: number }) {
  return { simDay: ctx.simDay, ...(ctx.runId ? { runId: ctx.runId } : {}) };
}

const mock: AgentSpec["mock"] = (history) => {
  const snap = lastResult(history, "get_store_snapshot");
  const analysis = lastResult(history, "ask_analytics");
  const support = lastResult(history, "run_support");
  const content = lastResult(history, "assign_content");

  if (!snap) {
    return {
      thinking: "New check-in. First a quick look at the whole store before deciding anything.",
      calls: [{ name: "get_store_snapshot", input: {} }],
    };
  }
  if (!analysis) {
    return {
      thinking: `${snap.products.length} products live, ${snap.openTickets} open tickets, ${snap.posts.awaitingOwnerApproval} posts awaiting approval. I don't know yet which product needs help or which channel works. Asking Analytics rather than guessing.`,
      calls: [
        {
          name: "ask_analytics",
          input: { question: "Which product is weakest, which channel converts best, and are our posts bringing visitors?" },
        },
      ],
    };
  }
  if (snap.openTickets > 0 && !support) {
    return {
      thinking: `Analytics says: "${analysis.answer.split("\n")[0]}". Before pushing for more buyers, ${snap.openTickets} customers are waiting — unhappy buyers cost more than missed sales. Sending Support in first.`,
      calls: [{ name: "run_support", input: {} }],
    };
  }
  if (!content) {
    const flagged = analysis.answer.match(/Weakest: ([\w-]+)/)?.[1];
    const untouched = snap.products.filter((p: any) => p.version === 1).map((p: any) => p.slug);
    const weakest = flagged && untouched.includes(flagged) ? flagged : untouched[0] ?? flagged ?? snap.products[0].slug;
    const why =
      weakest === flagged
        ? `Analytics flagged ${weakest} as the weakest seller.`
        : `Analytics flagged ${flagged}, but Content already reworked that one. ${weakest}'s listing has never been checked, so that's the better use of this round.`;
    return {
      thinking: `${why} Most likely fix is the listing plus a promo post on the channel that converts. Assigning Content, and telling it to check claims first so we don't promote something untrue.`,
      calls: [
        {
          name: "assign_content",
          input: {
            slug: weakest,
            instructions: "Check the listing's claims against the files, rewrite it with only true claims, then draft one X post with a tracked link.",
          },
        },
      ],
    };
  }
  return {
    thinking: "Three actions done this round. Next check-in will show whether the new post brings visits.",
    answer: [
      `Analytics: ${analysis.answer.split("\n")[0]}`,
      support ? `Support: ${support.answer}` : "",
      `Content: ${content.answer}`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
};

export const operatorAgent: AgentSpec = {
  agent: "operator",
  effort: "medium",
  tools,
  mock,
  system: loadPrompt("operator"),
};

// One team run: the operator plus every helper it calls share one token budget.
export async function operatorTick(simDay: number, runId?: string) {
  const { result, used, limit, byAgent } = await withTokenBudget(() =>
    runAgent(
      operatorAgent,
      `Check-in for day ${simDay}. Review the store and take up to 3 actions that will sell more of its products. ` +
        `The whole team shares a budget of ${config.runTokenBudget} tokens for this run, so keep it short.`,
      { simDay, ...(runId ? { runId } : {}) }
    )
  );
  const split = Object.entries(byAgent).map(([a, n]) => `${a} ${n}`).join(", ");
  const usage = `Tokens used: ${used} of ${limit}${split ? ` (${split})` : ""}.`;
  console.log(`[budget] ${usage}`);
  const db = getDb();
  const row = db.select().from(agentRuns).where(eq(agentRuns.id, result.agentRunId)).get();
  db.update(agentRuns)
    .set({ result: `${row?.result ?? result.answer}\n${usage}` })
    .where(eq(agentRuns.id, result.agentRunId))
    .run();
  return { ...result, tokensUsed: used, tokenLimit: limit };
}
