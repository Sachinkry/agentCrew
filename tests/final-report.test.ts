import { describe, it, expect } from "vitest";
import { lastActionsReport, splitFinalCalls } from "../src/core/agent.js";
import { operatorAgent } from "../src/agents/operator.js";
import { analyticsAgent } from "../src/agents/analytics.js";
import { contentAgent } from "../src/agents/content.js";
import { supportAgent } from "../src/agents/support.js";

// trace 85d8f765 (check-in 18): Content's last turn shipped listing v7 and a blog post, but the
// Operator got only "Last actions: update_listing ok; publish_blog_post ok." — no version, no URL —
// and spent another call on get_store_snapshot to find out what happened.
describe("regression: a budget-final turn hands back what its tools returned", () => {
  const outcomes = [
    { name: "update_listing", isError: false, text: '{\n  "ok": true,\n  "version": 7,\n  "url": "/p/neatlogs"\n}' },
    {
      name: "publish_blog_post",
      isError: false,
      text: '{\n  "ok": true,\n  "postId": "86d32e50",\n  "url": "/blog/what-a-fintech-ops-reviewer-needs-in-an-ai-agent-trace-to-si",\n  "promotes": [\n    "neatlogs"\n  ]\n}',
    },
  ];

  it("includes each tool's result, compacted", () => {
    expect(lastActionsReport("", outcomes)).toBe(
      'Done in this job:\n- update_listing ok: {"ok":true,"version":7,"url":"/p/neatlogs"}\n' +
        '- publish_blog_post ok: {"ok":true,"postId":"86d32e50","url":"/blog/what-a-fintech-ops-reviewer-needs-in-an-ai-agent-trace-to-si","promotes":["neatlogs"]}'
    );
  });

  it("keeps the model's own text first and shows failures", () => {
    const r = lastActionsReport("Rewrote the listing.", [{ name: "draft_post", isError: true, text: "BLOCKED by store rules" }]);
    expect(r).toBe("Rewrote the listing.\n\nDone in this job:\n- draft_post failed: BLOCKED by store rules");
  });

  it("cuts a long result so the parent's context stays small", () => {
    const r = lastActionsReport("", [{ name: "get_post_performance", isError: false, text: JSON.stringify({ rows: "x".repeat(2000) }) }]);
    expect(r.length).toBeLessThan(400);
    expect(r).toMatch(/…$/);
  });
});

// trace be812d5b (fresh check-in 1): Content shipped a blog post, 2 X drafts and listing v2, then spent
// its budget-final action on get_product — a read nothing could use. Its whole report was that read,
// cut at 300 chars; the blog URL and drafts never reached the Operator, which re-checked the snapshot.
describe("regression: a budget-final turn skips reads and reports the whole job", () => {
  const tools = new Map(contentAgent.tools.map((t) => [t.name, t]));

  it("doesn't run read-only calls on the final turn", () => {
    const uses = [
      { id: "1", name: "get_product", input: { slug: "neatlogs" } },
      { id: "2", name: "update_listing", input: {} },
    ];
    const { run, skipped } = splitFinalCalls(uses, tools);
    expect(run.map((u) => u.name)).toEqual(["update_listing"]);
    expect(skipped.map((u) => u.name)).toEqual(["get_product"]);
  });

  it("reports every action of the job, so the blog URL reaches the Operator", () => {
    const job = [
      { name: "publish_blog_post", isError: false, text: '{"ok":true,"postId":"a5d73bb6","url":"/blog/the-agent-got-this-wrong-isn-t-a-bug-report-send-this-instea","promotes":["neatlogs"]}' },
      { name: "draft_post", isError: false, text: '{"postId":"4b17f1bc","link":"/p/neatlogs?src=x&post=4b17f1bc","approval":"pending"}' },
      { name: "draft_post", isError: false, text: '{"postId":"6b11e464","link":"/p/neatlogs?src=x&post=6b11e464","approval":"pending"}' },
      { name: "update_listing", isError: false, text: '{"ok":true,"version":2,"url":"/p/neatlogs"}' },
    ];
    const r = lastActionsReport("", job);
    expect(r).toContain("/blog/the-agent-got-this-wrong-isn-t-a-bug-report-send-this-instea");
    expect(r).toContain('"version":2');
    expect(r.match(/draft_post ok/g)).toHaveLength(2);
    expect(r).not.toContain("get_product");
  });

  // Reads are skipped on a final turn and left out of the report; adding a read tool means listing it here.
  it("marks exactly the lookup tools as read-only", () => {
    const reads = [operatorAgent, analyticsAgent, contentAgent, supportAgent]
      .flatMap((a) => a.tools)
      .filter((t) => t.readOnly)
      .map((t) => t.name)
      .sort();
    expect(reads).toEqual([
      "find_similar_companies", "get_competitor_profiles", "get_post_performance", "get_product",
      "get_sales_summary", "get_store_snapshot", "get_traffic_sources", "inspect_product_files", "list_open_tickets",
    ]);
  });
});
