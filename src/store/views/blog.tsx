// /blog: posts written by the Content agent to promote products.

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Cover, PriceTag, StorePage, typeLabel } from "./layout.js";

export interface BlogPostView {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  publishedAt: Date;
}

interface PromotedProduct {
  slug: string;
  title: string;
  type: string;
  priceCents: number;
  priceLabel?: string | null;
  vendor?: string | null;
}

const date = (d: Date) => d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

// Product links carry the post id so Analytics can credit this post with visits and sales.
const tracked = (href: string, postId: string) =>
  href.startsWith("/p/") ? `${href.split("?")[0]}?src=blog&post=${postId}` : href;

// Inline markdown: **bold** and [text](/internal/link). External links render as plain text.
function inline(text: string, postId: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={m.index}>{m[1]}</strong>);
    else if (m[3]!.startsWith("/"))
      out.push(
        <a key={m.index} href={tracked(m[3]!, postId)} className="font-medium underline underline-offset-2">
          {m[2]}
        </a>
      );
    else out.push(m[2]);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// Block markdown: '## '/'### ' headings, '- ' bullet lists, blank-line separated paragraphs.
function Markdown({ body, postId }: { body: string; postId: string }) {
  const blocks = body.replace(/\r/g, "").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className="flex flex-col gap-4 text-[17px] leading-relaxed">
      {blocks.map((b, i) => {
        if (b.startsWith("### "))
          return (
            <h3 key={i} className="mt-2 text-xl font-bold">
              {inline(b.slice(4), postId)}
            </h3>
          );
        if (b.startsWith("## ") || b.startsWith("# "))
          return (
            <h2 key={i} className="mt-4 text-2xl font-bold tracking-tight">
              {inline(b.replace(/^#+ /, ""), postId)}
            </h2>
          );
        const lines = b.split("\n");
        if (lines.every((l) => /^[-*] /.test(l)))
          return (
            <ul key={i} className="flex list-disc flex-col gap-1.5 pl-6">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.slice(2), postId)}</li>
              ))}
            </ul>
          );
        return <p key={i}>{inline(lines.join(" "), postId)}</p>;
      })}
    </div>
  );
}

export function BlogIndexPage({ posts }: { posts: BlogPostView[] }) {
  return (
    <StorePage title="Blog">
      <h1 className="mb-2 text-[clamp(32px,5vw,48px)] leading-tight font-bold tracking-tighter">Blog</h1>
      <p className="mb-8 text-lg text-muted-foreground">Guides and notes from the team behind the shelf.</p>
      {posts.length === 0 ? (
        <p className="text-muted-foreground">No posts yet.</p>
      ) : (
        <div className="flex flex-col gap-5">
          {posts.map((p) => (
            <a
              key={p.id}
              href={`/blog/${p.slug}`}
              className="transition-[translate,box-shadow] hover:-translate-x-1 hover:-translate-y-1 hover:shadow-[4px_4px_0_0_var(--color-foreground)]"
            >
              <Card className="gap-2">
                <CardHeader className="gap-2">
                  <span className="text-sm text-muted-foreground">{date(p.publishedAt)}</span>
                  <CardTitle className="text-2xl leading-tight">{p.title}</CardTitle>
                  <CardDescription className="text-base">{p.summary}</CardDescription>
                </CardHeader>
              </Card>
            </a>
          ))}
        </div>
      )}
    </StorePage>
  );
}

export function BlogPostPage({ post, products }: { post: BlogPostView; products: PromotedProduct[] }) {
  return (
    <StorePage title={post.title}>
      <a href="/blog" className="text-sm hover:underline">
        ← All posts
      </a>
      <article className="mt-4">
        <span className="text-sm text-muted-foreground">{date(post.publishedAt)}</span>
        <h1 className="mt-1 mb-3 text-[clamp(30px,5vw,44px)] leading-tight font-bold tracking-tighter">{post.title}</h1>
        <p className="mb-8 text-xl text-muted-foreground">{post.summary}</p>
        <Markdown body={post.body} postId={post.id} />
      </article>
      {products.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-4 text-xl font-bold">Featured in this post</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-5">
            {products.map((p) => (
              <Card key={p.slug} className="gap-0 overflow-hidden py-0">
                <Cover type={p.type} title={p.title} className="aspect-[4/3]" />
                <div className="flex items-center gap-2.5 border-b px-4 py-3">
                  <PriceTag cents={p.priceCents} label={p.priceLabel} />
                  <Badge variant="outline" className="capitalize">
                    {typeLabel(p.type)}
                  </Badge>
                </div>
                <div className="p-4">
                  <Button asChild className="w-full">
                    <a href={tracked(`/p/${p.slug}`, post.id)}>{p.vendor ? `Try ${p.vendor}` : "I want this!"}</a>
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}
    </StorePage>
  );
}
