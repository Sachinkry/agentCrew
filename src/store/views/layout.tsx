import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cn } from "@/lib/utils";

export function render(page: ReactElement): string {
  return "<!doctype html>" + renderToStaticMarkup(page);
}

export function Document({
  title,
  description,
  refresh,
  children,
}: {
  title: string;
  description?: string;
  refresh?: boolean;
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        {refresh && <meta httpEquiv="refresh" content="3" />}
        {description && <meta name="description" content={description} />}
        <title>{title}</title>
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}

export function SiteHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3.5">
        <a href="/" className="text-2xl font-extrabold tracking-tighter">
          autoshelf
        </a>
        <span className="flex-1" />
        {children ?? (
          <nav className="flex gap-5">
            <a href="/blog" className="hover:underline">
              Blog
            </a>
            <a href="/ops" className="hover:underline">
              Watch the agents
            </a>
          </nav>
        )}
      </div>
    </header>
  );
}

export function StorePage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Document title={`${title} — AutoShelf`}>
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 pt-8 pb-20">{children}</main>
    </Document>
  );
}

// Gumroad's pink price tag with a pointed right edge.
export function PriceTag({ cents, decimals = 0, label }: { cents: number; decimals?: number; label?: string | null }) {
  return (
    <span className="relative mr-2.5 inline-block border border-foreground bg-primary px-2.5 py-0.5 font-bold whitespace-nowrap after:absolute after:top-1/2 after:-right-[9px] after:size-3.5 after:-translate-y-1/2 after:rotate-45 after:border-t after:border-r after:border-foreground after:bg-primary after:content-['']">
      {label ?? `$${(cents / 100).toFixed(decimals)}`}
    </span>
  );
}

const TYPE_COLORS: Record<string, string> = {
  observability: "bg-[#ff90e8]",
  dev_tool: "bg-[#90a8ed]",
  data_api: "bg-[#23a094]",
  spreadsheet: "bg-[#23a094]",
  rules_pack: "bg-[#90a8ed]",
  prompt_pack: "bg-[#ffc900]",
  code_kit: "bg-[#ff90e8]",
  guide: "bg-[#f1f333]",
  planner: "bg-[#ffb3a7]",
};

export const typeLabel = (type: string) => type.replace("_", " ");

export function Cover({
  type,
  title,
  className,
  titleClassName,
}: {
  type: string;
  title: string;
  className?: string;
  titleClassName?: string;
}) {
  return (
    <div className={cn("flex items-end border-b p-4", TYPE_COLORS[type] ?? "bg-neutral-200", className)}>
      <span className={cn("text-[22px] leading-tight font-extrabold tracking-tight", titleClassName)}>
        {title}
      </span>
    </div>
  );
}
