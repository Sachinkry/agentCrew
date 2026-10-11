import { z } from "zod";
import { callLlmParsed } from "../core/llm.js";
import { withSpan } from "../core/trace.js";
import { getDb } from "../core/db.js";
import { tickets, messages, orders, products, events } from "../core/schema.js";
import { check } from "../services/policy.js";
import { requestApproval } from "../services/approvals.js";
import { recordRefund } from "../services/ledger.js";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import fs from "fs";

const systemPrompt = fs.readFileSync(
  new URL("./prompts/support.md", import.meta.url),
  "utf-8"
);

const SupportOutputSchema = z.object({
  action: z.enum(["reply", "propose_refund", "escalate"]),
  message: z.string(),
  refundAmountCents: z.number().optional(),
  reasoning: z.string(),
});

export interface TicketContext {
  runId?: string;
  simDay: number;
}

export async function handleTicket(
  ticketId: string,
  ctx: TicketContext
): Promise<void> {
  return withSpan(
    "support:handle_ticket",
    { ticket_id: ticketId, sim_day: ctx.simDay },
    async (span) => {
      const db = getDb();

      const ticket = db
        .select()
        .from(tickets)
        .where(eq(tickets.id, ticketId))
        .get();

      if (!ticket) throw new Error(`Ticket ${ticketId} not found`);
      if (ticket.status !== "open") return;

      // Gather context
      let orderContext = "";
      if (ticket.orderId) {
        const order = db
          .select()
          .from(orders)
          .where(eq(orders.id, ticket.orderId))
          .get();
        if (order) {
          const product = db
            .select()
            .from(products)
            .where(eq(products.id, order.productId))
            .get();
          orderContext = `Order: ${order.id}, Status: ${order.status}, Product: ${product?.title ?? "unknown"}, Paid: $${(order.pricePaidCents / 100).toFixed(2)}`;
        }
      }

      const priorMessages = db
        .select()
        .from(messages)
        .where(eq(messages.ticketId, ticketId))
        .all();

      const conversation = priorMessages
        .map((m) => `${m.role}: ${m.body}`)
        .join("\n");

      const output = await callLlmParsed(
        {
          agent: "support",
          tier: "cheap",
          systemPrompt,
          userMessage: `Ticket ID: ${ticketId}
Type: ${ticket.kind}
${orderContext}

Conversation so far:
${conversation || "(no prior messages)"}

Resolve this ticket. Return your action, message, and reasoning.`,
          runId: ctx.runId,
          simDay: ctx.simDay,
          parentSpanId: span.id,
        },
        SupportOutputSchema
      );

      // Record agent message
      db.insert(messages)
        .values({
          id: randomUUID(),
          ticketId,
          role: "agent",
          body: output.message,
          spanId: span.id,
        })
        .run();

      if (output.action === "propose_refund" && output.refundAmountCents) {
        const policyResult = check({
          type: "propose_refund",
          orderId: ticket.orderId ?? "unknown",
          amountCents: output.refundAmountCents,
          simDay: ctx.simDay,
          runId: ctx.runId,
        });

        if (policyResult.allowed) {
          // Auto-approve small refunds
          if (ticket.orderId) {
            recordRefund(ctx.simDay, output.refundAmountCents, ticket.orderId);
          }
          db.update(tickets)
            .set({ status: "resolved" })
            .where(eq(tickets.id, ticketId))
            .run();
        } else {
          // Large refund — goes to approval queue
          requestApproval({
            kind: "refund",
            payload: {
              ticketId,
              orderId: ticket.orderId,
              amountCents: output.refundAmountCents,
              reason: output.reasoning,
            },
          });
          db.update(tickets)
            .set({ status: "escalated" })
            .where(eq(tickets.id, ticketId))
            .run();
        }
      } else if (output.action === "escalate") {
        db.update(tickets)
          .set({ status: "escalated" })
          .where(eq(tickets.id, ticketId))
          .run();
      } else {
        // reply — mark resolved
        db.update(tickets)
          .set({ status: "resolved" })
          .where(eq(tickets.id, ticketId))
          .run();
      }

      db.insert(events)
        .values({
          id: randomUUID(),
          runId: ctx.runId ?? null,
          simDay: ctx.simDay,
          agent: "support",
          action: output.action,
          payloadJson: JSON.stringify({ ticketId, action: output.action }),
        })
        .run();
    }
  );
}

export async function handleAllOpenTickets(ctx: TicketContext): Promise<void> {
  const db = getDb();
  const openTickets = db
    .select()
    .from(tickets)
    .where(eq(tickets.status, "open"))
    .all();

  for (const ticket of openTickets) {
    await handleTicket(ticket.id, ctx);
  }
}
