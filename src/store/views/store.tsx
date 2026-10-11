// Public storefront pages: Gumroad-style, built from shadcn components.

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Cover, Document, PriceTag, SiteHeader, StorePage, typeLabel } from "./layout.js";

interface ShelfProduct {
  id: string;
  slug: string;
  title: string;
  description: string;
  priceCents: number;
  type: string;
  vendor?: string | null;
  ctaUrl?: string | null;
  priceLabel?: string | null;
}

export function HomePage({ items, src }: { items: ShelfProduct[]; src: string }) {
  const srcQs = src && src !== "direct" ? `?src=${encodeURIComponent(src)}` : "";
  return (
    <Document
      title="AutoShelf — tools for teams shipping AI agents"
      description="Hand-picked B2B tools for teams building AI agents, starting with neatlogs: traces, failure detection, investigations and evals."
    >
      <SiteHeader />
      <section className="border-b bg-card">
        <div className="mx-auto max-w-6xl px-4 py-12">
          <h1 className="mb-2.5 text-[clamp(32px,5vw,56px)] leading-[1.05] font-bold tracking-tighter">
            Tools for teams
            <br />
            shipping AI agents.
          </h1>
          <p className="max-w-xl text-lg text-muted-foreground">
            Find out why your agents fail, and how to fix it. Picked, reviewed and promoted by a team of AI
            agents.
          </p>
        </div>
      </section>
      <main className="mx-auto max-w-6xl px-4 pt-8 pb-20">
        <h2 className="mb-4 text-xl font-bold">All products</h2>
        {items.length === 0 ? (
          <p>No products yet.</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-5">
            {items.map((p) => (
              <a
                key={p.slug}
                href={`/p/${p.slug}${srcQs}`}
                className="transition-[translate,box-shadow] hover:-translate-x-1 hover:-translate-y-1 hover:shadow-[4px_4px_0_0_var(--color-foreground)]"
              >
                <Card className="h-full gap-0 overflow-hidden py-0">
                  <Cover type={p.type} title={p.title} className="aspect-square" />
                  <CardHeader className="flex-1 gap-1.5 px-4 py-3.5">
                    <CardTitle className="text-[17px] leading-snug">{p.title}</CardTitle>
                    <CardDescription>{p.description.slice(0, 110)}</CardDescription>
                  </CardHeader>
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 border-t px-4 py-3">
                    <PriceTag cents={p.priceCents} label={p.priceLabel} />
                    <Badge variant="outline" className="capitalize">
                      {typeLabel(p.type)}
                    </Badge>
                  </div>
                </Card>
              </a>
            ))}
          </div>
        )}
      </main>
    </Document>
  );
}

export function ProductPage({ product, trackQs = "" }: { product: ShelfProduct; trackQs?: string }) {
  const host = product.ctaUrl ? new URL(product.ctaUrl).hostname.replace(/^app\./, "") : null;
  return (
    <StorePage title={product.title}>
      <Card className="grid gap-0 overflow-hidden py-0 sm:grid-cols-[1.4fr_1fr]">
        <Cover
          type={product.type}
          title={product.title}
          className="aspect-video p-6 sm:col-span-2"
          titleClassName="text-[clamp(24px,4vw,40px)]"
        />
        <div className="border-b p-6 sm:border-r sm:border-b-0">
          <h1 className="mb-3 text-[28px] leading-tight font-bold">{product.title}</h1>
          <p className="text-muted-foreground">{product.description}</p>
        </div>
        <div className="flex flex-col gap-4 p-6">
          <div className="flex items-center gap-2">
            <PriceTag cents={product.priceCents} decimals={2} label={product.priceLabel} />
            <Badge variant="outline" className="capitalize">
              {typeLabel(product.type)}
            </Badge>
          </div>
          {product.ctaUrl ? (
            <>
              <Button asChild size="lg">
                <a href={`/go/${product.slug}${trackQs}`}>Try {product.vendor ?? "it"} free</a>
              </Button>
              <small className="text-muted-foreground">Continues on {host}. Sign up directly with {product.vendor}.</small>
            </>
          ) : (
            <>
              <Button asChild size="lg">
                <a href={`/checkout/${product.id}`}>I want this!</a>
              </Button>
              <small className="text-muted-foreground">Instant download after payment.</small>
            </>
          )}
        </div>
      </Card>
    </StorePage>
  );
}

export function NoticePage({
  title,
  message,
  variant = "warning",
}: {
  title: string;
  message: string;
  variant?: "warning" | "success" | "default";
}) {
  return (
    <StorePage title={title}>
      <Alert variant={variant}>
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription className="text-foreground">{message}</AlertDescription>
      </Alert>
    </StorePage>
  );
}

export function SuccessPage({ orderId, token }: { orderId?: string; token?: string }) {
  return (
    <StorePage title="Purchase Successful">
      <Alert variant="success" className="gap-y-3 p-6">
        <AlertTitle className="text-2xl font-bold">Thank you for your purchase!</AlertTitle>
        <AlertDescription className="gap-4 text-base text-foreground">
          {token ? (
            <>
              <p>
                Order ID: <code className="font-mono text-sm">{orderId}</code>
              </p>
              <Button asChild size="lg">
                <a href={`/download/${token}`}>Download your product</a>
              </Button>
            </>
          ) : (
            <p>Check your email for your download link.</p>
          )}
        </AlertDescription>
      </Alert>
    </StorePage>
  );
}

export function DownloadPage({
  title,
  orderId,
  token,
  files,
}: {
  title: string;
  orderId: string;
  token: string;
  files: string[];
}) {
  return (
    <StorePage title="Download">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Your download: {title}</CardTitle>
          <CardDescription>Order {orderId}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="flex flex-col gap-2">
            {files.map((f) => (
              <li key={f}>
                <Button asChild variant="outline" className="w-full justify-start">
                  <a href={`/download/${token}/file/${encodeURIComponent(f)}`}>{f}</a>
                </Button>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">Links expire 72 hours after purchase.</p>
        </CardContent>
      </Card>
    </StorePage>
  );
}
