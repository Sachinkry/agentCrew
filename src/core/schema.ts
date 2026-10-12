import {
  sqliteTable,
  text,
  integer,
  real,
  blob,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  seed: integer("seed").notNull(),
  gitSha: text("git_sha"),
  entireCheckpoint: text("entire_checkpoint"),
  traceRoot: text("trace_root"),
  configJson: text("config_json").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  type: text("type", {
    enum: [
      "spreadsheet", "rules_pack", "prompt_pack", "code_kit", "guide", "planner",
      // B2B tools the store refers buyers to
      "observability", "dev_tool", "data_api",
    ],
  }).notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  priceCents: integer("price_cents").notNull(),
  costCentsEst: integer("cost_cents_est").notNull().default(0),
  status: text("status", {
    enum: ["draft", "verified", "live", "retired"],
  })
    .notNull()
    .default("draft"),
  artifactPath: text("artifact_path"),
  // B2B listings: who makes it, where "Try it" sends the buyer, and a price line like "Free · from $99/mo".
  vendor: text("vendor"),
  ctaUrl: text("cta_url"),
  priceLabel: text("price_label"),
  version: integer("version").notNull().default(1),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const claims = sqliteTable("claims", {
  id: text("id").primaryKey(),
  productId: text("product_id")
    .notNull()
    .references(() => products.id),
  text: text("text").notNull(),
  verified: integer("verified", { mode: "boolean" }),
  note: text("note"),
});

export const channels = sqliteTable("channels", {
  id: text("id").primaryKey(),
  name: text("name", { enum: ["web", "x", "email", "blog"] })
    .notNull()
    .unique(),
});

export const posts = sqliteTable("posts", {
  id: text("id").primaryKey(),
  channelId: text("channel_id")
    .notNull()
    .references(() => channels.id),
  productId: text("product_id").references(() => products.id),
  body: text("body").notNull(),
  status: text("status", {
    enum: ["draft", "approved", "published"],
  })
    .notNull()
    .default("draft"),
  utm: text("utm"),
  simDay: integer("sim_day").notNull(),
});

export const traffic = sqliteTable("traffic", {
  id: text("id").primaryKey(),
  simDay: integer("sim_day").notNull(),
  channelId: text("channel_id")
    .notNull()
    .references(() => channels.id),
  productId: text("product_id").references(() => products.id),
  utm: text("utm"),
  sessions: integer("sessions").notNull().default(0),
  addToCart: integer("add_to_cart").notNull().default(0),
});

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  productId: text("product_id")
    .notNull()
    .references(() => products.id),
  channelId: text("channel_id")
    .notNull()
    .references(() => channels.id),
  pricePaidCents: integer("price_paid_cents").notNull(),
  discountPct: real("discount_pct").notNull().default(0),
  status: text("status", {
    enum: ["paid", "delivered", "refunded"],
  })
    .notNull()
    .default("paid"),
  dodoRef: text("dodo_ref"),
  simDay: integer("sim_day").notNull(),
  downloadToken: text("download_token"),
  tokenExpiresAt: integer("token_expires_at", { mode: "timestamp" }),
});

export const tickets = sqliteTable("tickets", {
  id: text("id").primaryKey(),
  orderId: text("order_id").references(() => orders.id),
  kind: text("kind", {
    enum: ["presale", "delivery", "refund", "complaint"],
  }).notNull(),
  status: text("status", {
    enum: ["open", "resolved", "escalated"],
  })
    .notNull()
    .default("open"),
  simDay: integer("sim_day").notNull(),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  ticketId: text("ticket_id")
    .notNull()
    .references(() => tickets.id),
  role: text("role", { enum: ["customer", "agent", "human"] }).notNull(),
  body: text("body").notNull(),
  spanId: text("span_id"),
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  fromAgent: text("from_agent").notNull(),
  toAgent: text("to_agent").notNull(),
  brief: text("brief").notNull(),
  status: text("status", {
    enum: ["open", "done", "failed"],
  })
    .notNull()
    .default("open"),
  resultJson: text("result_json"),
  simDay: integer("sim_day").notNull(),
});

export const experiments = sqliteTable("experiments", {
  id: text("id").primaryKey(),
  hypothesis: text("hypothesis").notNull(),
  lever: text("lever", {
    enum: [
      "price",
      "listing",
      "post_style",
      "bundle",
      "discount",
      "new_product",
      "retire",
    ],
  }).notNull(),
  targetId: text("target_id"),
  paramsJson: text("params_json").notNull(),
  startDay: integer("start_day").notNull(),
  endDay: integer("end_day"),
  resultJson: text("result_json"),
  decision: text("decision", { enum: ["keep", "revert", "pending"] })
    .notNull()
    .default("pending"),
});

export const marketSignals = sqliteTable("market_signals", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  category: text("category").notNull(),
  keyword: text("keyword").notNull(),
  score: real("score").notNull(),
  observedDay: integer("observed_day").notNull(),
});

export const approvals = sqliteTable("approvals", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["post", "refund", "spend"] }).notNull(),
  payloadJson: text("payload_json").notNull(),
  status: text("status", {
    enum: ["pending", "approved", "rejected"],
  })
    .notNull()
    .default("pending"),
  decidedBy: text("decided_by"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const ledger = sqliteTable("ledger", {
  id: text("id").primaryKey(),
  simDay: integer("sim_day").notNull(),
  kind: text("kind", {
    enum: ["revenue", "cogs", "inference", "fee", "refund"],
  }).notNull(),
  amountCents: real("amount_cents").notNull(),
  refType: text("ref_type"),
  refId: text("ref_id"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const llmCalls = sqliteTable("llm_calls", {
  id: text("id").primaryKey(),
  runId: text("run_id"),
  agent: text("agent").notNull(),
  model: text("model").notNull(),
  inTokens: integer("in_tokens").notNull(),
  outTokens: integer("out_tokens").notNull(),
  costCents: real("cost_cents").notNull(), // fractions of a cent: one call is often < 0.1¢
  spanId: text("span_id"),
  simDay: integer("sim_day"),
});

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  runId: text("run_id"),
  simDay: integer("sim_day").notNull(),
  agent: text("agent").notNull(),
  action: text("action").notNull(),
  payloadJson: text("payload_json").notNull(),
  ts: integer("ts", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const runMetrics = sqliteTable("run_metrics", {
  runId: text("run_id").notNull(),
  simDay: integer("sim_day").notNull(),
  revenue: integer("revenue").notNull().default(0),
  profit: integer("profit").notNull().default(0),
  inferenceCost: integer("inference_cost").notNull().default(0),
  conversionByChannelJson: text("conversion_by_channel_json"),
  claimVerifiedRate: real("claim_verified_rate"),
  policyBlocks: integer("policy_blocks").notNull().default(0),
  costPerOrder: real("cost_per_order"),
});

// One agent working on one task. Sub-agents point at the run that called them.
export const agentRuns = sqliteTable("agent_runs", {
  id: text("id").primaryKey(),
  runId: text("run_id"),
  parentId: text("parent_id"),
  agent: text("agent").notNull(),
  task: text("task").notNull(),
  status: text("status", { enum: ["running", "done", "failed"] })
    .notNull()
    .default("running"),
  result: text("result"),
  costCents: real("cost_cents").notNull().default(0),
  simDay: integer("sim_day").notNull().default(0),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  endedAt: integer("ended_at", { mode: "timestamp_ms" }),
});

// Every thought, tool call, tool result and answer inside an agent run, in order.
export const agentSteps = sqliteTable("agent_steps", {
  id: text("id").primaryKey(),
  agentRunId: text("agent_run_id")
    .notNull()
    .references(() => agentRuns.id),
  seq: integer("seq").notNull(),
  kind: text("kind", {
    enum: ["thinking", "text", "tool_call", "tool_result", "error"],
  }).notNull(),
  toolName: text("tool_name"),
  content: text("content").notNull(),
  isError: integer("is_error", { mode: "boolean" }).notNull().default(false),
  childRunId: text("child_run_id"),
  ts: integer("ts", { mode: "timestamp_ms" }).notNull(),
});

// Real storefront visits, tagged with where the visitor came from.
// A buyer clicked through to a vendor's signup page: the store's "sale" for B2B listings.
export const leads = sqliteTable("leads", {
  id: text("id").primaryKey(),
  productId: text("product_id")
    .notNull()
    .references(() => products.id),
  src: text("src").notNull(),
  postId: text("post_id"),
  ts: integer("ts", { mode: "timestamp_ms" }).notNull(),
});

// Cached Crustdata API responses (keyed by endpoint + request), so repeat runs don't spend credits again.
export const crustdataCache = sqliteTable("crustdata_cache", {
  key: text("key").primaryKey(),
  response: text("response").notNull(),
  credits: real("credits"),
  fetchedAt: integer("fetched_at", { mode: "timestamp_ms" }).notNull(),
});

// Blog posts written and published by the Content agent to promote products.
export const blogPosts = sqliteTable("blog_posts", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  body: text("body").notNull(),
  productSlugs: text("product_slugs").notNull(), // JSON array of promoted product slugs
  agentRunId: text("agent_run_id"),
  simDay: integer("sim_day").notNull(),
  publishedAt: integer("published_at", { mode: "timestamp_ms" }).notNull(),
});

export const visits = sqliteTable("visits", {
  id: text("id").primaryKey(),
  path: text("path").notNull(),
  productSlug: text("product_slug"),
  src: text("src").notNull(),
  postId: text("post_id"),
  ts: integer("ts", { mode: "timestamp_ms" }).notNull(),
});
