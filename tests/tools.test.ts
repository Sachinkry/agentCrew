import { describe, it, expect } from "vitest";
import { operatorAgent } from "../src/agents/operator.js";
import { analyticsAgent } from "../src/agents/analytics.js";
import { contentAgent } from "../src/agents/content.js";
import { supportAgent } from "../src/agents/support.js";

// The exact tool set per agent. Adding a tool means updating this list on purpose.
describe("agent tools", () => {
  const names = (spec: { tools: { name: string }[] }) => spec.tools.map((t) => t.name).sort();

  it("operator: snapshot + one hand-off per helper, no price changes (vendor sets neatlogs' price)", () => {
    expect(names(operatorAgent)).toEqual(["ask_analytics", "assign_content", "get_store_snapshot", "run_support"]);
  });
  it("analytics: no separate AI-spend tool (AI cost is in the sales summary)", () => {
    expect(names(analyticsAgent)).toEqual([
      "find_similar_companies",
      "get_competitor_profiles",
      "get_post_performance",
      "get_sales_summary",
      "get_traffic_sources",
    ]);
  });
  it("content", () => {
    expect(names(contentAgent)).toEqual([
      "draft_post",
      "get_product",
      "inspect_product_files",
      "mark_claims",
      "publish_blog_post",
      "update_listing",
    ]);
  });
  it("support: no refunds (signups are handled by the vendor)", () => {
    expect(names(supportAgent)).toEqual(["escalate_to_human", "list_open_tickets", "reply_to_customer"]);
  });
  it("every tool name is unique within its agent", () => {
    for (const spec of [operatorAgent, analyticsAgent, contentAgent, supportAgent]) {
      expect(new Set(names(spec)).size).toBe(spec.tools.length);
    }
  });
});
