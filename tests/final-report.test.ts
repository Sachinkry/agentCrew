import { describe, it, expect } from "vitest";
import { lastActionsReport } from "../src/core/agent.js";

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
      'Last actions:\n- update_listing ok: {"ok":true,"version":7,"url":"/p/neatlogs"}\n' +
        '- publish_blog_post ok: {"ok":true,"postId":"86d32e50","url":"/blog/what-a-fintech-ops-reviewer-needs-in-an-ai-agent-trace-to-si","promotes":["neatlogs"]}'
    );
  });

  it("keeps the model's own text first and shows failures", () => {
    const r = lastActionsReport("Rewrote the listing.", [{ name: "draft_post", isError: true, text: "BLOCKED by store rules" }]);
    expect(r).toBe("Rewrote the listing.\n\nLast actions:\n- draft_post failed: BLOCKED by store rules");
  });

  it("cuts a long result so the parent's context stays small", () => {
    const r = lastActionsReport("", [{ name: "get_post_performance", isError: false, text: JSON.stringify({ rows: "x".repeat(2000) }) }]);
    expect(r.length).toBeLessThan(400);
    expect(r).toMatch(/…$/);
  });
});
