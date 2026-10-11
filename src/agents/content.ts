import { z } from "zod";
import { callLlmParsed } from "../core/llm.js";
import { withSpan } from "../core/trace.js";
import { getDb } from "../core/db.js";
import {
  products,
  claims,
  posts,
  tasks,
  events,
} from "../core/schema.js";
import { verifyClaims } from "../services/verify.js";
import { check } from "../services/policy.js";
import { requestApproval } from "../services/approvals.js";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import fs from "fs";
import path from "path";

const systemPrompt = fs.readFileSync(
  new URL("./prompts/content.md", import.meta.url),
  "utf-8"
);

// ── Schemas ──────────────────────────────────────────────────────────────────

const ListingOutputSchema = z.object({
  title: z.string(),
  description: z.string(),
  hook: z.string(),
  bulletBenefits: z.array(z.string()).min(3).max(5),
  claimsToVerify: z.array(z.string()),
  reasoning: z.string(),
});

const PostOutputSchema = z.object({
  body: z.string().max(280),
  utm: z.string(),
  reasoning: z.string(),
});

const LandingPageOutputSchema = z.object({
  headline: z.string(),
  subheading: z.string(),
  benefits: z.array(z.string()).length(3),
  ctaText: z.string(),
  html: z.string(),
  reasoning: z.string(),
});

// ── Tool implementations ──────────────────────────────────────────────────────

export async function publishListing(
  productId: string,
  context: { runId?: string; simDay: number }
): Promise<{ success: boolean; reason?: string }> {
  return withSpan(
    "content:publish_listing",
    { product_id: productId, sim_day: context.simDay },
    async (span) => {
      const db = getDb();
      const product = db
        .select()
        .from(products)
        .where(eq(products.id, productId))
        .get();
      if (!product) throw new Error(`Product ${productId} not found`);

      // Generate listing copy
      const listing = await callLlmParsed(
        {
          agent: "content",
          tier: "strong",
          systemPrompt,
          userMessage: `Create a listing for this product:
Title: ${product.title}
Type: ${product.type}
Artifact path: ${product.artifactPath ?? "N/A"}

Generate a compelling title, description, hook, 3-5 bullet benefits, and list of factual claims to verify.`,
          runId: context.runId,
          simDay: context.simDay,
          parentSpanId: span.id,
        },
        ListingOutputSchema
      );

      // Upsert claims
      for (const claimText of listing.claimsToVerify) {
        const claimId = randomUUID();
        db.insert(claims)
          .values({
            id: claimId,
            productId,
            text: claimText,
            verified: null,
          })
          .onConflictDoNothing()
          .run();
      }

      // Verify claims
      const verifyResult = await verifyClaims(
        productId,
        context.runId,
        context.simDay
      );

      // Policy check
      const policyResult = check({
        type: "publish_listing",
        productId,
        claimsVerified: verifyResult.allPassed,
        simDay: context.simDay,
        runId: context.runId,
      });

      if (!policyResult.allowed) {
        return { success: false, reason: policyResult.reason };
      }

      // Update product
      db.update(products)
        .set({
          title: listing.title,
          description: listing.description,
          status: "live",
          version: (product.version ?? 1) + 1,
        })
        .where(eq(products.id, productId))
        .run();

      db.insert(events)
        .values({
          id: randomUUID(),
          runId: context.runId ?? null,
          simDay: context.simDay,
          agent: "content",
          action: "publish_listing",
          payloadJson: JSON.stringify({ productId, verifiedRate: verifyResult.verifiedRate }),
        })
        .run();

      return { success: true };
    }
  );
}

export async function draftPost(
  productId: string,
  channel: "web" | "x",
  channelId: string,
  context: { runId?: string; simDay: number }
): Promise<string> {
  return withSpan(
    "content:draft_post",
    { product_id: productId, channel, sim_day: context.simDay },
    async (span) => {
      const db = getDb();
      const product = db
        .select()
        .from(products)
        .where(eq(products.id, productId))
        .get();
      if (!product) throw new Error(`Product ${productId} not found`);

      const output = await callLlmParsed(
        {
          agent: "content",
          tier: "cheap",
          systemPrompt,
          userMessage: `Write a ${channel === "x" ? "X/Twitter post (max 280 chars)" : "promotional web post"} for:
Product: ${product.title}
Price: $${((product.priceCents ?? 0) / 100).toFixed(2)}
Description: ${product.description}

Include a UTM parameter like ?utm_source=${channel}&utm_medium=post&utm_content=day${context.simDay}`,
          runId: context.runId,
          simDay: context.simDay,
          parentSpanId: span.id,
        },
        PostOutputSchema
      );

      const postId = randomUUID();
      db.insert(posts)
        .values({
          id: postId,
          channelId,
          productId,
          body: output.body,
          status: "draft",
          utm: output.utm,
          simDay: context.simDay,
        })
        .run();

      // Request approval
      const approval = requestApproval({
        kind: "post",
        payload: { postId, channel, body: output.body, productId },
      });

      if (approval.status === "approved") {
        db.update(posts)
          .set({ status: "approved" })
          .where(eq(posts.id, postId))
          .run();
      }

      return postId;
    }
  );
}

export async function createLandingPage(
  productId: string,
  context: { runId?: string; simDay: number }
): Promise<string> {
  return withSpan(
    "content:create_landing_page",
    { product_id: productId },
    async (span) => {
      const db = getDb();
      const product = db
        .select()
        .from(products)
        .where(eq(products.id, productId))
        .get();
      if (!product) throw new Error(`Product ${productId} not found`);

      const output = await callLlmParsed(
        {
          agent: "content",
          tier: "strong",
          systemPrompt,
          userMessage: `Create a landing page for:
Product: ${product.title}
Price: $${((product.priceCents ?? 0) / 100).toFixed(2)}
Description: ${product.description}

Return HTML that can be served directly. Keep it simple but conversion-optimized.`,
          runId: context.runId,
          simDay: context.simDay,
          parentSpanId: span.id,
        },
        LandingPageOutputSchema
      );

      // Save landing page HTML
      const lp = path.join("artifacts", product.slug, "landing.html");
      fs.mkdirSync(path.dirname(lp), { recursive: true });
      fs.writeFileSync(lp, output.html);

      return lp;
    }
  );
}

// ── Task runner ───────────────────────────────────────────────────────────────

export async function runTask(
  taskId: string,
  context: { runId?: string; simDay: number }
): Promise<void> {
  const db = getDb();
  const task = db
    .select()
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .get();

  if (!task || task.toAgent !== "content") {
    throw new Error(`Task ${taskId} not found or not for content`);
  }

  try {
    const brief = task.brief.toLowerCase();
    let result: unknown;

    if (brief.includes("publish listing") || brief.includes("publish_listing")) {
      const productId = task.brief.match(/product[_\s]id[:\s]+([a-f0-9-]+)/i)?.[1];
      if (!productId) throw new Error("No product_id in task brief");
      result = await publishListing(productId, context);
    } else if (brief.includes("draft post") || brief.includes("draft_post")) {
      const productId = task.brief.match(/product[_\s]id[:\s]+([a-f0-9-]+)/i)?.[1];
      const channel = brief.includes(" x ") || brief.includes("twitter") ? "x" : "web";
      if (!productId) throw new Error("No product_id in task brief");
      result = await draftPost(productId, channel, "web-channel-id", context);
    } else {
      result = { skipped: true, reason: "unknown task type" };
    }

    db.update(tasks)
      .set({ status: "done", resultJson: JSON.stringify(result) })
      .where(eq(tasks.id, taskId))
      .run();
  } catch (err) {
    db.update(tasks)
      .set({
        status: "failed",
        resultJson: JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }),
      })
      .where(eq(tasks.id, taskId))
      .run();
    throw err;
  }
}
