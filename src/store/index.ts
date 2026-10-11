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

const app = new Hono();

// ── Templates ─────────────────────────────────────────────────────────────────

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — AutoShelf</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f9fafb; color: #111; line-height: 1.6; }
    .container { max-width: 900px; margin: 0 auto; padding: 2rem 1rem; }
    .header { background: #fff; border-bottom: 1px solid #e5e7eb; padding: 1rem 2rem; display: flex; align-items: center; gap: 1rem; }
    .header h1 { font-size: 1.25rem; font-weight: 700; }
    .header a { color: inherit; text-decoration: none; }
    .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; }
    .price { font-size: 2rem; font-weight: 700; color: #059669; }
    .btn { display: inline-block; background: #2563eb; color: #fff; padding: .75rem 1.5rem; border-radius: 6px; text-decoration: none; font-weight: 600; border: none; cursor: pointer; font-size: 1rem; }
    .btn:hover { background: #1d4ed8; }
    .badge { display: inline-block; background: #dcfce7; color: #166534; padding: .2rem .6rem; border-radius: 4px; font-size: .8rem; font-weight: 600; }
    ul.benefits { list-style: none; margin: 1rem 0; }
    ul.benefits li::before { content: "✓ "; color: #059669; font-weight: 700; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1rem; }
    .product-card h2 { font-size: 1.1rem; margin-bottom: .5rem; }
    .product-card p { color: #6b7280; font-size: .9rem; margin-bottom: 1rem; }
    .alert { background: #fef3c7; border: 1px solid #f59e0b; border-radius: 6px; padding: 1rem; margin-bottom: 1rem; }
    .success { background: #d1fae5; border-color: #059669; }
  </style>
</head>
<body>
  <div class="header">
    <a href="/"><h1>AutoShelf</h1></a>
    <span style="color:#6b7280;font-size:.9rem;">Digital goods, built by AI</span>
  </div>
  <div class="container">${body}</div>
</body>
</html>`;
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get("/", (c) => {
  const db = getDb();
  const liveProducts = db
    .select()
    .from(products)
    .where(eq(products.status, "live"))
    .all();

  const cards = liveProducts
    .map(
      (p) => `
    <a href="/p/${p.slug}" style="text-decoration:none;color:inherit;">
      <div class="card product-card">
        <span class="badge">${p.type.replace("_", " ")}</span>
        <h2>${p.title}</h2>
        <p>${p.description.slice(0, 120)}…</p>
        <span class="price">$${(p.priceCents / 100).toFixed(2)}</span>
      </div>
    </a>`
    )
    .join("");

  return c.html(
    layout(
      "Store",
      `<h2 style="margin-bottom:1.5rem;">Digital Products</h2>
      <div class="grid">${cards || "<p>No products yet.</p>"}</div>`
    )
  );
});

app.get("/p/:slug", (c) => {
  const db = getDb();
  const product = db
    .select()
    .from(products)
    .where(eq(products.slug, c.req.param("slug")))
    .get();

  if (!product) return c.html(layout("Not Found", "<p>Product not found.</p>"), 404);

  return c.html(
    layout(
      product.title,
      `<div class="card">
        <span class="badge">${product.type.replace("_", " ")}</span>
        <h1 style="margin:1rem 0">${product.title}</h1>
        <p style="color:#6b7280;margin-bottom:1.5rem;">${product.description}</p>
        <div class="price" style="margin-bottom:1.5rem;">$${(product.priceCents / 100).toFixed(2)}</div>
        <a href="/checkout/${product.id}" class="btn">Buy Now</a>
      </div>`
    )
  );
});

app.get("/checkout/:productId", async (c) => {
  const db = getDb();
  const product = db
    .select()
    .from(products)
    .where(eq(products.id, c.req.param("productId")))
    .get();

  if (!product) return c.html(layout("Not Found", "<p>Product not found.</p>"), 404);

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
      layout(
        "Error",
        `<div class="alert">Checkout error: ${err instanceof Error ? err.message : "unknown"}</div>`
      ),
      500
    );
  }
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

    return c.html(
      layout(
        "Purchase Successful",
        `<div class="card alert success">
          <h2>Thank you for your purchase!</h2>
          <p style="margin:1rem 0">Order ID: <code>${orderId}</code></p>
          <a href="/download/${token}" class="btn">Download Your Product</a>
        </div>`
      )
    );
  }

  return c.html(
    layout(
      "Purchase Successful",
      `<div class="card alert success">
        <h2>Thank you for your purchase!</h2>
        <p>Check your email for your download link.</p>
      </div>`
    )
  );
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
      layout(
        "Invalid Link",
        `<div class="alert">This download link is invalid or has expired. Contact support.</div>`
      ),
      404
    );
  }

  if (order.tokenExpiresAt && order.tokenExpiresAt < new Date()) {
    return c.html(
      layout(
        "Link Expired",
        `<div class="alert">This download link has expired. Please contact support for a new link.</div>`
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
      layout("Error", "<p>Product files not found. Contact support.</p>"),
      500
    );
  }

  const artifactDir = path.resolve(product.artifactPath);
  if (!fs.existsSync(artifactDir)) {
    return c.html(
      layout("Error", "<p>Product files not available yet. Contact support.</p>"),
      500
    );
  }

  // List files for download
  const files = fs.readdirSync(artifactDir).filter((f) => !f.startsWith("."));
  const fileList = files
    .map((f) => `<li><a href="/download/${token}/file/${f}">${f}</a></li>`)
    .join("");

  return c.html(
    layout(
      "Download",
      `<div class="card">
        <h2>Your Download: ${product.title}</h2>
        <p style="margin:1rem 0;color:#6b7280;">Order ${order.id}</p>
        <ul style="margin:1rem 0;padding-left:1.5rem;">${fileList}</ul>
        <p style="color:#6b7280;font-size:.85rem;">Links expire 72 hours after purchase.</p>
      </div>`
    )
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
