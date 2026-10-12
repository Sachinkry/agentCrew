// Content agent: writes everything the public sees — product listings, promo posts and blog posts.
// It must check each product claim against the real files before using it.

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import { loadPrompt, runAgent, lastResult, type AgentSpec, type AgentTool } from "../core/agent.js";
import { getDb, sqlAll } from "../core/db.js";
import { blogPosts, claims, posts, products } from "../core/schema.js";
import { check } from "../services/policy.js";
import { requestApproval } from "../services/approvals.js";

// Agents only work on products the store currently sells (status "live").
function findProduct(slug: unknown) {
  const p = getDb().select().from(products).where(eq(products.slug, String(slug))).get();
  if (!p || p.status !== "live") throw new Error(`no live product with slug "${slug}"`);
  return p;
}

function productClaims(productId: string) {
  return getDb().select().from(claims).where(eq(claims.productId, productId)).all();
}

// Facts about the product files that claims can be checked against.
function inspectFiles(artifactPath: string) {
  const dir = path.resolve(artifactPath);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => !f.startsWith(".")) : [];
  const facts: Record<string, unknown> = {};
  let text = "";
  for (const f of files) {
    const full = path.join(dir, f);
    if (f.endsWith(".xlsx")) {
      const wb = XLSX.read(fs.readFileSync(full));
      facts["sheetNames"] = wb.SheetNames;
      facts["sheetCount"] = wb.SheetNames.length;
    } else if (f.endsWith(".md")) {
      text += fs.readFileSync(full, "utf-8") + "\n";
    }
  }
  const promptHeadings = text.match(/^### /gm)?.length ?? 0;
  if (promptHeadings) facts["promptCount"] = promptHeadings;
  facts["sectionCount"] = text.match(/^## /gm)?.length ?? 0;
  facts["containsSampleOutputs"] = /sample output/i.test(text);
  return { files, facts, excerpt: text.slice(0, 4000) };
}

const tools: AgentTool[] = [
  {
    name: "get_product",
    readOnly: true,
    description: "Look up a product's current listing (title, description, price), the claims made about it, and its posts (drafts await the owner's approval).",
    input_schema: {
      type: "object",
      properties: { slug: { type: "string" } },
      required: ["slug"],
    },
    run: async ({ slug }) => {
      const p = findProduct(slug);
      return {
        slug: p.slug,
        title: p.title,
        description: p.description,
        priceCents: p.priceCents,
        status: p.status,
        claims: productClaims(p.id).map((c) => ({ claim: c.text, verified: c.verified, note: c.note })),
        // Drafts wait for the store owner's approval; only the owner can publish them.
        posts: sqlAll(
          `SELECT po.id, c.name AS channel,
                  CASE po.status WHEN 'draft' THEN 'awaiting owner approval' ELSE po.status END AS status
           FROM posts po JOIN channels c ON c.id = po.channel_id
           WHERE po.product_id = ? ORDER BY po.id`,
          p.id
        ),
      };
    },
  },
  {
    name: "inspect_product_files",
    readOnly: true,
    description:
      "Open the actual files a buyer would download and report hard facts (file names, sheet/prompt counts, an excerpt). Use this to check claims.",
    input_schema: {
      type: "object",
      properties: { slug: { type: "string" } },
      required: ["slug"],
    },
    run: async ({ slug }) => {
      const p = findProduct(slug);
      return inspectFiles(p.artifactPath ?? "");
    },
  },
  {
    name: "mark_claims",
    description: "Record whether each claim is true according to the product files. Only claims marked true may appear in listings.",
    input_schema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        verdicts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              claim: { type: "string", description: "exact claim text from get_product, or a new claim you want to use" },
              verified: { type: "boolean" },
              note: { type: "string" },
            },
            required: ["claim", "verified", "note"],
          },
        },
      },
      required: ["slug", "verdicts"],
    },
    run: async ({ slug, verdicts }) => {
      const p = findProduct(slug);
      const db = getDb();
      const existing = productClaims(p.id);
      let updated = 0;
      let added = 0;
      for (const v of verdicts as Array<{ claim: string; verified: boolean; note: string }>) {
        const row = existing.find((c) => c.text === v.claim);
        if (row) {
          db.update(claims).set({ verified: v.verified, note: v.note }).where(eq(claims.id, row.id)).run();
          updated++;
        } else {
          // A new claim the writer wants to use: record it, so the listing gate knows about it too.
          db.insert(claims).values({ id: randomUUID(), productId: p.id, text: v.claim, verified: v.verified, note: v.note }).run();
          added++;
        }
      }
      return { updated, added, failed: (verdicts as any[]).filter((v) => !v.verified).map((v) => v.claim) };
    },
  },
  {
    name: "update_listing",
    description:
      "Rewrite the product's public title and description. Blocked if any claim is unchecked or if the description repeats a claim that failed.",
    input_schema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
      },
      required: ["slug", "title", "description"],
    },
    run: async ({ slug, title, description }, ctx) => {
      const p = findProduct(slug);
      const all = productClaims(p.id);
      const unchecked = all.filter((c) => c.verified === null);
      const usesFailed = all.filter(
        (c) => c.verified === false && String(description).toLowerCase().includes(c.text.toLowerCase())
      );
      const verdict = check({
        type: "publish_listing",
        productId: p.id,
        claimsVerified: unchecked.length === 0 && usesFailed.length === 0,
        simDay: ctx.simDay,
        ...(ctx.runId ? { runId: ctx.runId } : {}),
      });
      if (!verdict.allowed) {
        throw new Error(
          `BLOCKED by store rules: ${verdict.reason}. Unchecked: ${unchecked.length}, failed claims used: ${usesFailed.map((c) => c.text).join("; ") || "none"}`
        );
      }
      getDb()
        .update(products)
        .set({ title: String(title), description: String(description), version: p.version + 1 })
        .where(eq(products.id, p.id))
        .run();
      return { ok: true, version: p.version + 1, url: `/p/${p.slug}` };
    },
  },
  {
    name: "draft_post",
    description:
      "Draft a promo post for X or the blog. A tracked link to the product is added automatically so Analytics can see which posts bring buyers.",
    input_schema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        channel: { type: "string", enum: ["x", "web"] },
        body: { type: "string", description: "post text without the link; under 250 characters for x" },
      },
      required: ["slug", "channel", "body"],
    },
    run: async ({ slug, channel, body }, ctx) => {
      const p = findProduct(slug);
      const postId = randomUUID().slice(0, 8);
      const link = `/p/${p.slug}?src=${channel}&post=${postId}`;
      getDb()
        .insert(posts)
        .values({
          id: postId,
          channelId: `channel_${channel}`,
          productId: p.id,
          body: `${body} ${link}`,
          status: "draft",
          utm: link,
          simDay: ctx.simDay,
        })
        .run();
      const approval = requestApproval({ kind: "post", payload: { postId, channel, body } });
      return { postId, link, approval: approval.status };
    },
  },
];

function slugify(title: string): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "post";
  let slug = base;
  for (let i = 2; getDb().select().from(blogPosts).where(eq(blogPosts.slug, slug)).get(); i++) slug = `${base}-${i}`;
  return slug;
}

tools.push({
  name: "publish_blog_post",
  description:
    "Write and publish a blog post on the store's /blog to promote one or more products. " +
    "Body is simple markdown: '## ' headings, paragraphs, '- ' bullets, **bold**, and links like [Product name](/p/<slug>). " +
    "Product links get tracking added automatically. Only promote products whose claims you've already checked (inspect_product_files + mark_claims), and only use verified claims.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "headline, under 90 characters" },
      summary: { type: "string", description: "one or two sentences shown on the blog index" },
      body: { type: "string", description: "the post, 150-800 words, in the simple markdown described above" },
      product_slugs: { type: "array", items: { type: "string" }, description: "products this post promotes" },
    },
    required: ["title", "summary", "body", "product_slugs"],
  },
  run: async ({ title, summary, body, product_slugs }, ctx) => {
    const slugs = Array.isArray(product_slugs) ? product_slugs.map(String) : [];
    if (!slugs.length) throw new Error("product_slugs must list at least one product");
    const promoted = slugs.map(findProduct);
    for (const p of promoted) {
      const unchecked = productClaims(p.id).filter((c) => c.verified === null);
      if (unchecked.length)
        throw new Error(`check ${p.slug}'s claims first (inspect_product_files, then mark_claims); ${unchecked.length} unchecked`);
    }
    const text = String(body);
    if (text.length < 300 || text.length > 8000) throw new Error(`body must be 300-8000 characters (got ${text.length})`);

    const id = randomUUID().slice(0, 8);
    const slug = slugify(String(title));
    const db = getDb();
    db.insert(blogPosts)
      .values({
        id,
        slug,
        title: String(title).slice(0, 120),
        summary: String(summary).slice(0, 400),
        body: text,
        productSlugs: JSON.stringify(slugs),
        agentRunId: ctx.agentRunId,
        simDay: ctx.simDay,
        publishedAt: new Date(),
      })
      .run();
    // Also a post on the blog channel, so Analytics can attribute visits (?src=blog&post=<id>).
    db.insert(posts)
      .values({
        id,
        channelId: "channel_blog",
        productId: promoted[0]!.id,
        body: String(title),
        status: "published",
        utm: `/blog/${slug}`,
        simDay: ctx.simDay,
      })
      .run();
    return { ok: true, postId: id, url: `/blog/${slug}`, promotes: slugs };
  },
});

const KNOWN_SLUGS = ["neatlogs", "entire", "crustdata"]; // mock only; live products are enforced by findProduct

// Mock fact-check: compare numbers in a claim with the counted facts.
function judge(claim: string, facts: Record<string, any>) {
  const n = Number(claim.match(/\d+/)?.[0]);
  if (/prompt/i.test(claim) && n && facts["promptCount"] !== undefined && n !== facts["promptCount"])
    return { verified: false, note: `files contain ${facts["promptCount"]} prompts, not ${n}` };
  if (/sample output/i.test(claim) && !facts["containsSampleOutputs"])
    return { verified: false, note: "no sample outputs found in the files" };
  if (/tab/i.test(claim) && n && facts["sheetCount"] !== undefined && facts["sheetCount"] < n)
    return { verified: false, note: `workbook has ${facts["sheetCount"]} sheets` };
  if (/workflows/i.test(claim) && n && facts["sectionCount"] !== n)
    return { verified: false, note: `files have ${facts["sectionCount"]} sections, not ${n}` };
  return { verified: true, note: "consistent with the files" };
}

const mock: AgentSpec["mock"] = (history, task) => {
  const slug = KNOWN_SLUGS.find((s) => task.includes(s)) ?? KNOWN_SLUGS[0]!;
  const product = lastResult(history, "get_product");
  const files = lastResult(history, "inspect_product_files");
  const marked = lastResult(history, "mark_claims");
  const listing = lastResult(history, "update_listing");
  const post = lastResult(history, "draft_post");
  const blog = lastResult(history, "publish_blog_post");

  if (!product) {
    return {
      thinking: `I've been asked to improve ${slug}. Before writing anything public I need to see the current listing and what it claims.`,
      calls: [{ name: "get_product", input: { slug } }],
    };
  }
  if (!files) {
    return {
      thinking: `The listing makes ${product.claims.length} claims. I won't repeat any of them until I've checked them against the files a buyer actually downloads.`,
      calls: [{ name: "inspect_product_files", input: { slug } }],
    };
  }
  if (!marked) {
    const verdicts = product.claims.map((c: any) => ({ claim: c.claim, ...judge(c.claim, files.facts) }));
    const bad = verdicts.filter((v: any) => !v.verified);
    return {
      thinking: bad.length
        ? `Checked each claim against the files. ${bad.length} don't hold up: ${bad.map((b: any) => `"${b.claim}" (${b.note})`).join(", ")}. I'll record that and leave them out of the copy.`
        : `All ${verdicts.length} claims match the files. Recording them as verified.`,
      calls: [{ name: "mark_claims", input: { slug, verdicts } }],
    };
  }
  if (!listing) {
    const good = product.claims.map((c: any) => c.claim).filter((c: string) => !marked.failed.includes(c));
    // Correct any wrong counts that also appear in the title/intro (e.g. "25 prompts" → "23 prompts").
    const fixCounts = (text: string) => {
      let out = text;
      for (const claim of marked.failed as string[]) {
        const n = claim.match(/\d+/)?.[0];
        const actual = /prompt/i.test(claim) ? files.facts.promptCount : undefined;
        if (n && actual !== undefined) out = out.replace(new RegExp(`\\b${n}\\b`, "g"), String(actual));
      }
      return out;
    };
    const intro = fixCounts(product.description.split(". ")[0].replace(/\.$/, "").split(" What you get")[0]);
    return {
      thinking: `Rewriting the listing using only the ${good.length} verified claims${marked.failed.length ? ", and correcting the wrong numbers in the title and intro too, since they repeat the false claims" : ""}.`,
      calls: [
        {
          name: "update_listing",
          input: {
            slug,
            title: fixCounts(product.title),
            description: `${intro}. What you get: ${good.join("; ")}.`,
          },
        },
      ],
    };
  }
  if (!post) {
    return {
      thinking: "Listing is accurate now. Drafting an X post with a tracked link so Analytics can tell whether it brings visitors.",
      calls: [
        {
          name: "draft_post",
          input: { slug, channel: "x", body: `${product.title}: ${product.description.split(". ")[0].replace(/\.$/, "").slice(0, 140)}.` },
        },
      ],
    };
  }
  if (!blog) {
    const good = product.claims.map((c: any) => c.claim).filter((c: string) => !marked.failed.includes(c));
    const title = listing.title ?? product.title;
    return {
      thinking: "A short blog post gives search visitors a reason to land on this product. It's a real company's product, so I'll stick to the verified claims and not speak for the vendor.",
      calls: [
        {
          name: "publish_blog_post",
          input: {
            title: `${title.split(" — ")[0]}: what it does for teams shipping AI agents`,
            summary: `A quick, honest look at ${title.split(" — ")[0]}: what it does, who it's for, and what you get.`,
            body: [
              `## What it does`,
              `${product.description}`,
              `## What you get`,
              ...good.map((c: string) => `- ${c}`),
              `## Who it's for`,
              `Teams building and running AI agents who want this part of the stack handled by a dedicated tool instead of something home-grown.`,
              `[Try ${title.split(" — ")[0]}](/p/${slug})`,
            ].join("\n\n"),
            product_slugs: [slug],
          },
        },
      ],
    };
  }
  return {
    thinking: "Listing updated, post drafted and blog post published. Reporting back.",
    answer: `Updated ${slug} (v${listing.version ?? "?"}). Removed ${marked.failed.length} untrue claim(s)${marked.failed.length ? `: ${marked.failed.join("; ")}` : ""}. Drafted X post ${post.postId} → ${post.link}. Published blog post → ${blog.url}.`,
  };
};

export const contentAgent: AgentSpec = {
  agent: "content",
  effort: "low",
  tools,
  mock,
  system: loadPrompt("content"),
};

export function assignContent(task: string, opts: { runId?: string; simDay: number; parentId?: string }) {
  return runAgent(contentAgent, task, opts);
}
