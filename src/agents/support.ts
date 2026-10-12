// Support agent: answers buyers, handles delivery problems and refund requests.
// It can refund small amounts itself; anything over the limit is blocked and escalated.

import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { loadPrompt, runAgent, lastResult, type AgentSpec, type AgentTool } from "../core/agent.js";
import { getDb, sqlAll } from "../core/db.js";
import { messages, tickets } from "../core/schema.js";

function addMessage(ticketId: string, body: string, role: "agent" | "customer" = "agent") {
  getDb().insert(messages).values({ id: randomUUID(), ticketId, role, body }).run();
}

function setTicket(ticketId: string, status: "resolved" | "escalated") {
  getDb().update(tickets).set({ status }).where(eq(tickets.id, ticketId)).run();
}

const tools: AgentTool[] = [
  {
    name: "list_open_tickets",
    readOnly: true,
    description: "Open customer tickets with the customer's message, the order and the product.",
    input_schema: { type: "object", properties: { limit: { type: "number" } } },
    run: async ({ limit }) =>
      sqlAll(
        `SELECT t.id AS ticketId, t.kind, t.order_id AS orderId, p.title AS product,
                o.price_paid_cents AS paidCents, o.status AS orderStatus,
                (SELECT body FROM messages m WHERE m.ticket_id = t.id AND m.role='customer' LIMIT 1) AS customerMessage
         FROM tickets t LEFT JOIN orders o ON o.id = t.order_id
         LEFT JOIN products p ON p.id = o.product_id
         WHERE t.status = 'open' ORDER BY t.sim_day LIMIT ?`,
        Number(limit ?? 5)
      ),
  },
  {
    name: "reply_to_customer",
    description: "Send a reply to the customer and close the ticket.",
    input_schema: {
      type: "object",
      properties: { ticketId: { type: "string" }, message: { type: "string" } },
      required: ["ticketId", "message"],
    },
    run: async ({ ticketId, message }) => {
      addMessage(String(ticketId), String(message));
      setTicket(String(ticketId), "resolved");
      return { ok: true, ticketId, status: "resolved" };
    },
  },
  {
    name: "escalate_to_human",
    description: "Hand the ticket to the store owner when you can't or shouldn't resolve it yourself.",
    input_schema: {
      type: "object",
      properties: { ticketId: { type: "string" }, reason: { type: "string" } },
      required: ["ticketId", "reason"],
    },
    run: async ({ ticketId, reason }) => {
      addMessage(String(ticketId), `Escalated: ${reason}`);
      setTicket(String(ticketId), "escalated");
      return { ok: true, status: "escalated" };
    },
  },
];

const mock: AgentSpec["mock"] = (history) => {
  const open = lastResult<any[]>(history, "list_open_tickets");
  if (!open) {
    return {
      thinking: "Checking the support queue first so I know what's waiting.",
      calls: [{ name: "list_open_tickets", input: { limit: 3 } }],
    };
  }
  const handled = new Set(
    history
      .filter((h) => h.name !== "list_open_tickets" && !(h.result as any)?.error)
      .map((h) => h.input["ticketId"])
  );
  const next = open.find((t) => !handled.has(t.ticketId));
  if (!next) {
    const escalated = history.filter((h) => h.name === "escalate_to_human").length;
    return {
      thinking: "Queue handled. Summarising for the operator.",
      answer: open.length
        ? `Handled ${open.length} ticket(s); ${escalated} refund request(s) went to a human.`
        : "No open tickets.",
    };
  }
  if (next.kind === "refund") {
    return {
      thinking: `Ticket ${next.ticketId.slice(0, 8)}: customer wants a refund for "${next.product}". They say: "${next.customerMessage}". Money isn't mine to move; the store owner decides refunds. Escalating.`,
      calls: [{ name: "escalate_to_human", input: { ticketId: next.ticketId, reason: "refund request" } }],
    };
  }
  return {
    thinking: `Ticket ${next.ticketId.slice(0, 8)} is a ${next.kind}: "${next.customerMessage}". This needs an answer, not money. Replying with help.`,
    calls: [
      {
        name: "reply_to_customer",
        input: {
          ticketId: next.ticketId,
          message: `Sorry about that! Your download link for "${next.product}" is on your order page and stays valid for 72 hours. Reply here if anything is still unclear.`,
        },
      },
    ],
  };
};

export const supportAgent: AgentSpec = {
  agent: "support",
  effort: "low",
  tools,
  mock,
  system: loadPrompt("support"),
};

export function runSupport(opts: { runId?: string; simDay: number; parentId?: string }) {
  return runAgent(supportAgent, "Handle the open support tickets (up to 3).", opts);
}
