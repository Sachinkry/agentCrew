import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { getDb } from "../core/db.js";
import { products, orders, channels } from "../core/schema.js";
import { eq } from "drizzle-orm";
import {
  createCheckoutSession,
  parseWebhookEvent,
  verifyWebhookSignature,
} from "./payments.js";
import { getOrderByToken, generateDownloadToken } from "./delivery.js";
import { recordRevenue, recordFee } from "../services/ledger.js";
import { config } from "../core/config.js";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import type { Context } from "hono";
import { visits } from "../core/schema.js";
import { seedStore } from "../core/seed.js";
import { serveStatic } from "@hono/node-server/serve-static";
import { ops } from "./ops.js";
import { initTracing } from "../core/trace.js";
import { render } from "./views/layout.js";
import { DownloadPage, HomePage, NoticePage, ProductPage, SuccessPage } from "./views/store.js";
import { BlogIndexPage, BlogPostPage } from "./views/blog.js";
import { blogPosts, leads } from "../core/schema.js";
import { desc, inArray } from "drizzle-orm";

// Agent check-ins started from /ops are traced under this workflow; each request gets its own trace.
void initTracing("ops-agent-check-in");

const app = new Hono();
seedStore();
app.route("/ops", ops);
app.use("/styles.css", serveStatic({ path: "./public/styles.css" }));

// Record where each visitor came from: ?src=x&post=abc from agent posts, else the referrer.
function trackVisit(c: Context, productSlug?: string): string {
  let src = c.req.query("src") ?? "";
  if (!src) {
    const ref = c.req.header("referer");
    const host = c.req.header("host");
    try {
      const refHost = ref ? new URL(ref).host : "";
      src = refHost && refHost !== host ? refHost : "direct";
    } catch {
      src = "direct";
    }
  }
  src = src.slice(0, 64);
  getDb()
    .insert(visits)
    .values({
      id: randomUUID(),
      path: c.req.path,
      productSlug: productSlug ?? null,
      src,
      postId: c.req.query("post")?.slice(0, 16) ?? null,
      ts: new Date(),
    })
    .run();
  return src;
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get("/", (c) => {
  const src = trackVisit(c);
  const liveProducts = getDb().select().from(products).where(eq(products.status, "live")).all();
  return c.html(render(<HomePage items={liveProducts} src={src} />));
});

app.get("/blog", (c) => {
  trackVisit(c);
  const posts = getDb().select().from(blogPosts).orderBy(desc(blogPosts.publishedAt)).all();
  return c.html(render(<BlogIndexPage posts={posts} />));
});

app.get("/blog/:slug", (c) => {
  const post = getDb().select().from(blogPosts).where(eq(blogPosts.slug, c.req.param("slug"))).get();
  if (!post) return c.html(render(<NoticePage title="Not found" message="No such blog post." />), 404);
  trackVisit(c);
  const slugs: string[] = JSON.parse(post.productSlugs);
  const promoted = slugs.length
    ? getDb().select().from(products).where(inArray(products.slug, slugs)).all()
    : [];
  return c.html(render(<BlogPostPage post={post} products={promoted} />));
});

app.get("/p/:slug", (c) => {
  const db = getDb();
  const product = db
    .select()
    .from(products)
    .where(eq(products.slug, c.req.param("slug")))
    .get();

  // Only products the store currently sells are public.
  if (!product || product.status !== "live")
    return c.html(render(<NoticePage title="Not found" message="Product not found." />), 404);
  trackVisit(c, product.slug);

  // Carry the source/post through to the vendor click so the lead is credited correctly.
  const src = c.req.query("src");
  const post = c.req.query("post");
  const qs = new URLSearchParams({ ...(src ? { src } : {}), ...(post ? { post } : {}) }).toString();
  return c.html(render(<ProductPage product={product} trackQs={qs ? `?${qs}` : ""} />));
});

// "Try it" on a B2B listing: record the lead, then send the buyer to the vendor with UTM tags.
app.get("/go/:slug", (c) => {
  const product = getDb().select().from(products).where(eq(products.slug, c.req.param("slug"))).get();
  if (!product?.ctaUrl || product.status !== "live")
    return c.html(render(<NoticePage title="Not found" message="Product not found." />), 404);
  const src = trackVisit(c, product.slug);
  const postId = c.req.query("post")?.slice(0, 16) ?? null;
  getDb()
    .insert(leads)
    .values({ id: randomUUID(), productId: product.id, src, postId, ts: new Date() })
    .run();
  const dest = new URL(product.ctaUrl);
  dest.searchParams.set("utm_source", "autoshelf");
  dest.searchParams.set("utm_medium", src);
  if (postId) dest.searchParams.set("utm_campaign", postId);
  return c.redirect(dest.toString());
});

app.get("/checkout/success", async (c) => {
  const productId = c.req.query("product_id");
  const isMock = c.req.query("mock") === "1";

  if (isMock && productId) {
    const db = getDb();
    const product = db
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .get();

    // Create mock order
    const orderId = randomUUID();
    const { token, expiresAt } = generateDownloadToken(orderId);

    db.insert(orders)
      .values({
        id: orderId,
        productId: productId,
        channelId: "channel_web",
        pricePaidCents: product?.priceCents ?? 0,
        discountPct: 0,
        status: "delivered",
        dodoRef: `mock_${orderId}`,
        simDay: 0,
        downloadToken: token,
        tokenExpiresAt: expiresAt,
      })
      .run();

    if (product) {
      const feeCents = Math.floor(
        product.priceCents * (config.platformFeePct / 100)
      );
      recordRevenue(0, product.priceCents, orderId);
      recordFee(0, feeCents, orderId);
    }

    return c.html(render(<SuccessPage orderId={orderId} token={token} />));
  }

  return c.html(render(<SuccessPage />));
});

app.get("/checkout/:productId", async (c) => {
  const db = getDb();
  const product = db
    .select()
    .from(products)
    .where(eq(products.id, c.req.param("productId")))
    .get();

  if (!product) return c.html(render(<NoticePage title="Not found" message="Product not found." />), 404);

  const host = c.req.header("host") ?? "localhost:3000";
  const proto = host.includes("localhost") ? "http" : "https";

  try {
    const session = await createCheckoutSession({
      productId: product.id,
      productTitle: product.title,
      priceCents: product.priceCents,
      successUrl: `${proto}://${host}/checkout/success?product_id=${product.id}`,
      cancelUrl: `${proto}://${host}/p/${product.slug}`,
      metadata: { product_id: product.id },
    });

    return c.redirect(session.url);
  } catch (err) {
    return c.html(
      render(
        <NoticePage
          title="Checkout error"
          message={err instanceof Error ? err.message : "unknown"}
        />
      ),
      500
    );
  }
});

app.post("/webhook/dodo", async (c) => {
  const body = await c.req.text();
  const sig = c.req.header("dodo-signature") ?? "";

  if (!verifyWebhookSignature(body, sig)) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  let event;
  try {
    event = parseWebhookEvent(body);
  } catch {
    return c.json({ error: "Invalid payload" }, 400);
  }

  if (event.type === "payment.succeeded") {
    const db = getDb();
    const productId = event.data.metadata?.["product_id"] as string | undefined;
    if (productId) {
      const product = db
        .select()
        .from(products)
        .where(eq(products.id, productId))
        .get();

      if (product) {
        const orderId = randomUUID();
        const { token, expiresAt } = generateDownloadToken(orderId);
        db.insert(orders)
          .values({
            id: orderId,
            productId,
            channelId: "channel_web",
            pricePaidCents: event.data.amount ?? product.priceCents,
            discountPct: 0,
            status: "delivered",
            dodoRef: event.data.id,
            simDay: 0,
            downloadToken: token,
            tokenExpiresAt: expiresAt,
          })
          .run();

        const feeCents = Math.floor(
          product.priceCents * (config.platformFeePct / 100)
        );
        recordRevenue(0, product.priceCents, orderId);
        recordFee(0, feeCents, orderId);
      }
    }
  }

  return c.json({ ok: true });
});

app.get("/download/:token", (c) => {
  const token = c.req.param("token");
  const order = getOrderByToken(token);

  if (!order) {
    return c.html(
      render(
        <NoticePage
          title="Invalid link"
          message="This download link is invalid or has expired. Contact support."
        />
      ),
      404
    );
  }

  if (order.tokenExpiresAt && order.tokenExpiresAt < new Date()) {
    return c.html(
      render(
        <NoticePage
          title="Link expired"
          message="This download link has expired. Please contact support for a new link."
        />
      ),
      410
    );
  }

  const db = getDb();
  const product = db
    .select()
    .from(products)
    .where(eq(products.id, order.productId))
    .get();

  if (!product?.artifactPath) {
    return c.html(
      render(<NoticePage title="Error" message="Product files not found. Contact support." />),
      500
    );
  }

  const artifactDir = path.resolve(product.artifactPath);
  if (!fs.existsSync(artifactDir)) {
    return c.html(
      render(<NoticePage title="Error" message="Product files not available yet. Contact support." />),
      500
    );
  }

  const files = fs.readdirSync(artifactDir).filter((f) => !f.startsWith("."));
  return c.html(
    render(<DownloadPage title={product.title} orderId={order.id} token={token} files={files} />)
  );
});

app.get("/download/:token/file/:filename", (c) => {
  const { token, filename } = c.req.param();
  const order = getOrderByToken(token);

  if (!order || (order.tokenExpiresAt && order.tokenExpiresAt < new Date())) {
    return c.text("Unauthorized", 401);
  }

  const db = getDb();
  const product = db
    .select()
    .from(products)
    .where(eq(products.id, order.productId))
    .get();

  if (!product?.artifactPath) return c.text("Not found", 404);

  // Sanitize filename to prevent path traversal
  const safe = path.basename(filename);
  const filePath = path.join(path.resolve(product.artifactPath), safe);

  if (!fs.existsSync(filePath)) return c.text("Not found", 404);

  const content = fs.readFileSync(filePath);
  c.header("Content-Disposition", `attachment; filename="${safe}"`);
  return c.body(content as unknown as ReadableStream);
});

// ── Start server ──────────────────────────────────────────────────────────────

const port = parseInt(process.env["PORT"] ?? "3000");
console.log(`[store] Listening on http://localhost:${port}`);

serve({ fetch: app.fetch, port });

export default app;
