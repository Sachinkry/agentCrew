// verify_claims: checks each product claim against the actual artifact.
// Listing may ONLY use verified claims. Returns per-claim pass/fail.

import { getDb } from "../core/db.js";
import { claims, products } from "../core/schema.js";
import { eq } from "drizzle-orm";
import { callLlmParsed } from "../core/llm.js";
import { withSpan } from "../core/trace.js";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const ClaimResultSchema = z.object({
  claimId: z.string(),
  pass: z.boolean(),
  note: z.string(),
});

const VerifyOutputSchema = z.object({
  results: z.array(ClaimResultSchema),
});

export interface VerifyResult {
  productId: string;
  allPassed: boolean;
  results: Array<{ claimId: string; text: string; pass: boolean; note: string }>;
  verifiedRate: number;
}

export async function verifyClaims(
  productId: string,
  runId?: string,
  simDay?: number
): Promise<VerifyResult> {
  return withSpan(
    "verify_claims",
    { product_id: productId },
    async (span) => {
      const db = getDb();

      const product = db
        .select()
        .from(products)
        .where(eq(products.id, productId))
        .get();

      if (!product) throw new Error(`Product ${productId} not found`);

      const productClaims = db
        .select()
        .from(claims)
        .where(eq(claims.productId, productId))
        .all();

      if (productClaims.length === 0) {
        return {
          productId,
          allPassed: true,
          results: [],
          verifiedRate: 1,
        };
      }

      // Read artifact for context
      let artifactContext = "";
      if (product.artifactPath) {
        try {
          const fullPath = path.resolve(product.artifactPath);
          if (fs.existsSync(fullPath)) {
            // For non-binary files, read first 3000 chars
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
              artifactContext = fs
                .readdirSync(fullPath)
                .slice(0, 20)
                .join("\n");
            } else if (stat.size < 500_000) {
              const buf = fs.readFileSync(fullPath);
              artifactContext = buf.toString("utf-8", 0, 3000);
            }
          }
        } catch {
          // Ignore read errors
        }
      }

      const claimsText = productClaims
        .map((c) => `ID: ${c.id}\nClaim: ${c.text}`)
        .join("\n---\n");

      const output = await callLlmParsed(
        {
          agent: "verify",
          tier: "mid",
          systemPrompt: `You are a strict claims verifier. Given a product's claims and its artifact content,
determine if each claim is factually supported by the artifact. Be strict — if you can't confirm, mark as failed.
Return ONLY valid JSON.`,
          userMessage: `Product: ${product.title}
Artifact content (first 3000 chars):
${artifactContext || "(no artifact content available)"}

Claims to verify:
${claimsText}

Return JSON: {"results": [{"claimId": "...", "pass": true/false, "note": "brief reason"}]}`,
          runId,
          simDay,
          parentSpanId: span.id,
        },
        VerifyOutputSchema
      );

      const results: VerifyResult["results"] = [];
      let passed = 0;

      for (const r of output.results) {
        const claim = productClaims.find((c) => c.id === r.claimId);
        if (!claim) continue;

        // Update claim in DB
        db.update(claims)
          .set({ verified: r.pass, note: r.note })
          .where(eq(claims.id, r.claimId))
          .run();

        results.push({
          claimId: r.claimId,
          text: claim.text,
          pass: r.pass,
          note: r.note,
        });

        if (r.pass) passed++;
      }

      const verifiedRate =
        results.length > 0 ? passed / results.length : 1;
      const allPassed = passed === results.length;

      return { productId, allPassed, results, verifiedRate };
    }
  );
}

export function getVerifiedClaims(productId: string): string[] {
  const db = getDb();
  return db
    .select({ text: claims.text })
    .from(claims)
    .where(eq(claims.productId, productId))
    .all()
    .filter((c) => c.text)
    .map((c) => c.text);
}

export function getClaimVerifiedRate(): number {
  const db = getDb();
  const total = db
    .select({ count: claims.id })
    .from(claims)
    .all().length;

  if (total === 0) return 1;

  const verified = db
    .select({ count: claims.id })
    .from(claims)
    .where(eq(claims.verified, true))
    .all().length;

  return verified / total;
}
