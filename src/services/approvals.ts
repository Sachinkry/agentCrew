// Approval queue for posts, large refunds, and over-cap spend.
// In demo mode (AUTO_APPROVE_DEMO=1) auto-approves but still logs.

import { randomUUID } from "crypto";
import { getDb } from "../core/db.js";
import { approvals } from "../core/schema.js";
import { config } from "../core/config.js";
import { eq } from "drizzle-orm";

type ApprovalKind = "post" | "refund" | "spend";

interface ApprovalRequest {
  kind: ApprovalKind;
  payload: Record<string, unknown>;
}

interface ApprovalResult {
  id: string;
  status: "pending" | "approved" | "rejected";
}

export function requestApproval(req: ApprovalRequest): ApprovalResult {
  const db = getDb();
  const id = randomUUID();

  const status: "pending" | "approved" | "rejected" =
    config.autoApproveDemo ? "approved" : "pending";

  db.insert(approvals).values({
    id,
    kind: req.kind,
    payloadJson: JSON.stringify(req.payload),
    status,
    decidedBy: config.autoApproveDemo ? "auto-demo" : null,
  }).run();

  if (config.autoApproveDemo) {
    console.log(`[approvals] auto-approved ${req.kind} id=${id}`);
  } else {
    console.log(`[approvals] pending ${req.kind} id=${id} — run approve:all to proceed`);
  }

  return { id, status };
}

export function approveAll(): number {
  const db = getDb();
  const pending = db
    .select()
    .from(approvals)
    .where(eq(approvals.status, "pending"))
    .all();

  for (const a of pending) {
    db.update(approvals)
      .set({ status: "approved", decidedBy: "cli:approve-all" })
      .where(eq(approvals.id, a.id))
      .run();
  }

  console.log(`[approvals] approved ${pending.length} items`);
  return pending.length;
}

export function isApproved(id: string): boolean {
  const db = getDb();
  const row = db
    .select({ status: approvals.status })
    .from(approvals)
    .where(eq(approvals.id, id))
    .get();
  return row?.status === "approved";
}

// CLI entry point
if (process.argv.includes("--approve-all")) {
  approveAll();
}
