// Analytics agent: reads the numbers and explains what is and isn't working.
// Read-only — it never changes the store.

import { loadPrompt, runAgent, lastResult, type AgentSpec, type AgentTool } from "../core/agent.js";
import { sqlAll } from "../core/db.js";
import { crustdata } from "../core/crustdata.js";

const cents = (n: number | null | undefined) => `$${((n ?? 0) / 100).toFixed(2)}`;

const tools: AgentTool[] = [
  {
    name: "get_sales_summary",
    readOnly: true,
    description:
      "Per live product: leads (clicks through to the vendor's signup — the main sales number for B2B listings), plus revenue, orders, refunds, AI cost and profit. Money is in cents.",
    input_schema: { type: "object", properties: {} },
    run: async () => {
      const [totals] = sqlAll<Record<string, number>>(`
        SELECT
          COALESCE(SUM(CASE WHEN kind='revenue' THEN amount_cents END),0) AS revenue,
          COALESCE(SUM(CASE WHEN kind='refund' THEN amount_cents END),0) AS refunds,
          COALESCE(SUM(CASE WHEN kind='fee' THEN amount_cents END),0) AS fees,
          COALESCE(SUM(CASE WHEN kind='inference' THEN amount_cents END),0) AS ai_cost,
          COALESCE(SUM(amount_cents),0) AS profit
        FROM ledger`);
      const byProduct = sqlAll(`
        SELECT p.slug, p.price_label,
               (SELECT COUNT(*) FROM leads l WHERE l.product_id = p.id) AS leads,
               (SELECT COUNT(*) FROM visits v WHERE v.product_slug = p.slug) AS page_visits,
               (SELECT COUNT(*) FROM orders o WHERE o.product_id = p.id) AS orders,
               (SELECT COALESCE(SUM(o.price_paid_cents),0) FROM orders o WHERE o.product_id = p.id) AS revenue
        FROM products p WHERE p.status = 'live'
        ORDER BY leads DESC`);
      return { totals, byProduct };
    },
  },
  {
    name: "get_traffic_sources",
    readOnly: true,
    description:
      "Where visitors come from and how many buy. Includes simulated traffic per channel and real storefront visits per source.",
    input_schema: { type: "object", properties: {} },
    run: async () => {
      const simulated = sqlAll(`
        SELECT c.name AS channel, SUM(t.sessions) AS sessions,
          (SELECT COUNT(*) FROM orders o WHERE o.channel_id = c.id) AS orders
        FROM traffic t JOIN channels c ON c.id = t.channel_id
        GROUP BY c.id`).map((r: any) => ({
        ...r,
        conversionPct: r.sessions ? +((r.orders / r.sessions) * 100).toFixed(2) : 0,
      }));
      const realVisits = sqlAll(
        `SELECT v.src, COUNT(*) AS visits,
                (SELECT COUNT(*) FROM leads l WHERE l.src = v.src) AS leads
         FROM visits v GROUP BY v.src ORDER BY leads DESC, visits DESC`
      );
      return { simulated, realVisits };
    },
  },
  {
    name: "get_post_performance",
    readOnly: true,
    description: "Each social/blog post for a live product (or the whole store), with the visits and leads its tracked links brought.",
    input_schema: { type: "object", properties: {} },
    run: async () =>
      sqlAll(`
        SELECT po.id, c.name AS channel, p.slug AS product, po.status,
               substr(po.body,1,80) AS preview,
               (SELECT COUNT(*) FROM visits v WHERE v.post_id = po.id) AS visits,
               (SELECT COUNT(*) FROM leads l WHERE l.post_id = po.id) AS leads
        FROM posts po JOIN channels c ON c.id = po.channel_id
        LEFT JOIN products p ON p.id = po.product_id
        WHERE po.product_id IS NULL OR p.status = 'live'
        ORDER BY leads DESC, visits DESC LIMIT 20`),
  },
];

// Competitors neatlogs itself names: its docs offer trace import from these tools
// (https://docs.neatlogs.com — "Import Traces"). neatlogs.com is included as the baseline.
const DEFAULT_COMPETITOR_DOMAINS = [
  "neatlogs.com",
  "langfuse.com",
  "langchain.com", // LangSmith
  "braintrust.dev",
  "raindrop.ai",
  "arize.com", // Phoenix
  "lmnr.ai", // Laminar
];

const short = (v: unknown, n = 220) => (typeof v === "string" ? (v.length > n ? v.slice(0, n) + "…" : v) : v);

// Keep only the numbers worth comparing, so profiles stay small in the agent's token budget.
function compactProfile(matchedOn: string, c: any) {
  if (!c) return { domain: matchedOn, found: false };
  const b = c.basic_info ?? {};
  const h = c.headcount ?? {};
  const f = c.funding ?? {};
  const wt = c.web_traffic;
  const comps = c.competitors;
  const compNames = Array.isArray(comps)
    ? comps
    : Array.isArray(comps?.competitors)
      ? comps.competitors
      : Array.isArray(comps?.competitor_websites)
        ? comps.competitor_websites
        : [];
  return {
    domain: b.primary_domain ?? matchedOn,
    name: b.name,
    description: short(b.description),
    founded: b.year_founded,
    employees: h.total ?? b.employee_count_range,
    headcount_growth_pct: h.growth_percent
      ? { "6m": h.growth_percent.six_months ?? h.growth_percent["6m"], "12m": h.growth_percent.yoy ?? h.growth_percent["12m"] }
      : undefined,
    funding_total_usd: f.total_investment_usd,
    last_round: f.last_round_type ? `${f.last_round_type} ${f.last_round_amount_usd ?? ""} (${f.last_fundraise_date ?? "?"})`.trim() : undefined,
    web_traffic: wt && typeof wt === "object"
      ? Object.fromEntries(Object.entries(wt).filter(([, v]) => typeof v === "number").slice(0, 4))
      : undefined,
    competitors_per_crustdata: compNames
      .slice(0, 8)
      .map((x: any) => (typeof x === "string" ? x : x?.name ?? x?.domain ?? x?.website))
      .filter(Boolean),
  };
}

tools.push(
  {
    name: "get_competitor_profiles",
    readOnly: true,
    description:
      "Compare neatlogs with its competitors using Crustdata company data: size, headcount growth, funding, web traffic and who Crustdata lists as their competitors. " +
      "Defaults to neatlogs plus the tools neatlogs itself names (Langfuse, LangSmith, Braintrust, Raindrop, Arize Phoenix, Laminar). Costs Crustdata credits on first call; cached for 7 days.",
    input_schema: {
      type: "object",
      properties: {
        domains: { type: "array", items: { type: "string" }, description: "company domains; omit for the default set" },
      },
    },
    run: async ({ domains }) => {
      const list = (Array.isArray(domains) && domains.length ? domains.map(String) : DEFAULT_COMPETITOR_DOMAINS).slice(0, 10);
      const { data, credits, cached } = await crustdata<any[]>("/company/enrich", {
        domains: list,
        fields: ["basic_info", "headcount", "funding", "web_traffic", "competitors"],
      });
      return {
        source: "Crustdata company enrich",
        cached,
        credits_used: credits,
        companies: data.map((r) => compactProfile(r.matched_on, r.matches?.[0]?.company_data)),
      };
    },
  },
  {
    name: "find_similar_companies",
    readOnly: true,
    description:
      "Search Crustdata for companies doing similar work to neatlogs (default query: LLM/agent observability, tracing and evals), to spot competitors we don't know about yet. Cheap: about 0.03 credits per result.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "what the companies do, in plain words" },
        limit: { type: "number", description: "max results, up to 15 (default 10)" },
      },
    },
    run: async ({ query, limit }) => {
      const { data, credits, cached } = await crustdata<any>("/company/search", {
        search: {
          query: String(query || "observability, tracing and evaluation tools for LLM applications and AI agents"),
          mode: "hybrid",
        },
        fields: ["basic_info.name", "basic_info.primary_domain", "basic_info.description", "basic_info.employee_count_range"],
        limit: Math.min(Math.max(Number(limit) || 10, 1), 15),
      });
      return {
        source: "Crustdata company search",
        cached,
        credits_used: credits,
        total_matches: data.total_count,
        companies: (data.companies ?? []).map((c: any) => ({
          name: c.basic_info?.name,
          domain: c.basic_info?.primary_domain,
          size: c.basic_info?.employee_count_range,
          description: short(c.basic_info?.description, 160),
        })),
      };
    },
  }
);

const mock: AgentSpec["mock"] = (history) => {
  const sales = lastResult(history, "get_sales_summary");
  const traffic = lastResult(history, "get_traffic_sources");
  const posts = lastResult<any[]>(history, "get_post_performance");

  if (!sales) {
    return {
      thinking:
        "The operator wants a read on the business. I'll pull leads and traffic together — lead counts alone don't tell me whether the problem is visitors or conversion.",
      calls: [
        { name: "get_sales_summary", input: {} },
        { name: "get_traffic_sources", input: {} },
      ],
    };
  }
  if (!posts) {
    const best = sales.byProduct?.[0];
    const worst = sales.byProduct?.[sales.byProduct.length - 1];
    return {
      thinking: `${best?.slug} has the most leads (${best?.leads}); ${worst?.slug} has the fewest (${worst?.leads}). AI cost so far is ${cents(-sales.totals.ai_cost)}. Before recommending more promotion I need to know whether posts are actually bringing visitors.`,
      calls: [{ name: "get_post_performance", input: {} }],
    };
  }
  const best = sales.byProduct?.[0];
  const worst = sales.byProduct?.[sales.byProduct.length - 1];
  const channels: any[] = traffic?.simulated ?? [];
  const topChannel = [...channels].sort((a, b) => b.conversionPct - a.conversionPct)[0];
  const postsWithVisits = posts.filter((p) => p.visits > 0).length;
  return {
    thinking: `${posts.length} posts exist, ${postsWithVisits} have brought visits, ${posts.filter((p) => p.leads > 0).length} have brought leads. ${topChannel ? `${topChannel.channel} converts best at ${topChannel.conversionPct}%.` : "No channel data yet."} Enough to give a recommendation.`,
    answer: [
      `Leads: ${sales.byProduct?.map((p: any) => `${p.slug} ${p.leads}`).join(", ")} (AI cost ${cents(-sales.totals.ai_cost)}).`,
      `Most leads: ${best?.slug} (${best?.leads}). Weakest: ${worst?.slug} (${worst?.leads} leads).`,
      topChannel ? `Best-converting channel: ${topChannel.channel} at ${topChannel.conversionPct}%.` : "",
      `Posts: ${posts.length} written, ${postsWithVisits} brought visits.`,
      `Recommendation: promote ${worst?.slug} on ${topChannel?.channel ?? "x"} and check its listing is accurate before spending more on it.`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
};

export const analyticsAgent: AgentSpec = {
  agent: "analytics",
  effort: "low",
  tools,
  mock,
  system: loadPrompt("analytics"),
};

export function askAnalytics(question: string, opts: { runId?: string; simDay: number; parentId?: string }) {
  return runAgent(analyticsAgent, question, opts);
}
