// /ops pages: agent check-ins and a step-by-step replay of each run.

import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Document, SiteHeader } from "./layout.js";

export interface RunRow {
  id: string;
  parent_id: string | null;
  agent: string;
  task: string;
  status: string;
  result: string | null;
  cost_cents: number;
  sim_day: number;
  started_at: number;
  ended_at: number | null;
}

export interface StepRow {
  seq: number;
  kind: string;
  tool_name: string | null;
  content: string;
  is_error: number;
  child_run_id: string | null;
}

// A run plus its steps; tool results that spawned a sub-agent carry that child run.
export interface RunTree {
  run: RunRow;
  steps: (StepRow & { child?: RunTree })[];
}

const AGENTS: Record<string, { badge: string; edge: string }> = {
  operator: { badge: "bg-indigo-300", edge: "border-l-indigo-400" },
  analytics: { badge: "bg-teal-300", edge: "border-l-teal-400" },
  content: { badge: "bg-amber-300", edge: "border-l-amber-400" },
  support: { badge: "bg-rose-300", edge: "border-l-rose-400" },
};
const FALLBACK = { badge: "bg-neutral-300", edge: "border-l-neutral-400" };

const money = (c: number) => `$${(c / 100).toFixed(3)}`;
const time = (ms: number) => new Date(ms).toLocaleString();
const dur = (r: RunRow) => (r.ended_at ? `${((r.ended_at - r.started_at) / 1000).toFixed(1)}s` : "running…");

function AgentBadge({ agent }: { agent: string }) {
  return (
    <Badge variant="outline" className={cn("text-foreground", (AGENTS[agent] ?? FALLBACK).badge)}>
      {agent}
    </Badge>
  );
}

function OpsPage({ title, refresh, children }: { title: string; refresh?: boolean; children: ReactNode }) {
  return (
    <Document title={`${title} · AutoShelf ops`} refresh={refresh}>
      <SiteHeader>
        <span className="hidden gap-1.5 sm:flex">
          {Object.keys(AGENTS).map((a) => (
            <AgentBadge key={a} agent={a} />
          ))}
        </span>
        <a href="/ops" className="hover:underline">
          Activity
        </a>
        <a href="/" className="hover:underline">
          Store →
        </a>
      </SiteHeader>
      <main className="mx-auto max-w-5xl px-4 pt-6 pb-20">{children}</main>
    </Document>
  );
}

export function OpsIndexPage({
  runs,
  teamRunning,
  lastError,
  mock,
}: {
  runs: (RunRow & { children: number; steps: number })[];
  teamRunning: boolean;
  lastError: string | null;
  mock: boolean;
}) {
  return (
    <OpsPage title="Activity" refresh={teamRunning || runs.some((r) => r.status === "running")}>
      <Card className="mb-6 gap-3 px-6 py-5 sm:flex-row sm:items-center">
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Run the agent team</h1>
          <p className="text-muted-foreground">
            One run: the Operator checks sales, asks Analytics what's working, has Content improve listings and
            draft promo posts, and has Support answer waiting buyers. Every step is traced in{" "}
            <a href="https://app.neatlogs.com" target="_blank" rel="noreferrer" className="underline">
              neatlogs
            </a>
            {mock && " (mock mode: scripted agents, no model calls)"}.
          </p>
        </div>
        <form method="post" action="/ops/check-in">
          <Button type="submit" size="lg" disabled={teamRunning}>
            {teamRunning ? "Team is working…" : "Run agent team"}
          </Button>
        </form>
      </Card>
      {lastError && (
        <Alert variant="warning" className="mb-4">
          <AlertTitle>Last run failed</AlertTitle>
          <AlertDescription className="text-foreground">{lastError}</AlertDescription>
        </Alert>
      )}
      <h2 className="mb-3 text-lg font-bold">Check-ins</h2>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead>Task / outcome</TableHead>
              <TableHead>Work</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Started</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  No agent runs yet. Click “Run agent team”.
                </TableCell>
              </TableRow>
            )}
            {runs.map((r) => (
              <TableRow key={r.id} className="align-top">
                <TableCell>
                  <AgentBadge agent={r.agent} />
                </TableCell>
                <TableCell className="max-w-md whitespace-normal">
                  <a href={`/ops/run/${r.id}`} className="font-medium hover:underline">
                    {r.task}
                  </a>
                  <div className="text-muted-foreground">{(r.result ?? "").split("\n")[0]?.slice(0, 160)}</div>
                </TableCell>
                <TableCell>
                  {r.children} helpers · {r.steps} steps
                </TableCell>
                <TableCell>
                  {r.status}
                  <div className="text-muted-foreground">{dur(r)}</div>
                </TableCell>
                <TableCell className="text-muted-foreground">{time(r.started_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </OpsPage>
  );
}

const Label = ({ children }: { children: ReactNode }) => (
  <div className="mb-0.5 text-[11px] tracking-wider text-muted-foreground uppercase">{children}</div>
);
const Pre = ({ children }: { children: ReactNode }) => (
  <pre className="mt-1.5 max-h-80 overflow-auto font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
    {children}
  </pre>
);
const stepBox = "my-2 rounded-md border px-3 py-2";

function Step({ s }: { s: RunTree["steps"][number] }) {
  if (s.kind === "thinking")
    return (
      <div className={cn(stepBox, "border-violet-300 bg-violet-50 italic")}>
        <Label>thinking</Label>
        {s.content}
      </div>
    );
  if (s.kind === "tool_call")
    return (
      <div className={cn(stepBox, "bg-card font-mono text-xs")}>
        <Label>tool call</Label>
        <b>{s.tool_name}</b>
        <Pre>{s.content}</Pre>
      </div>
    );
  if (s.kind === "tool_result")
    return (
      <>
        <div className={cn(stepBox, "font-mono text-xs", s.is_error ? "border-red-400 bg-red-50 text-red-900" : "bg-card")}>
          <details open={!!s.is_error}>
            <summary className="cursor-pointer text-muted-foreground">
              {s.is_error ? "tool error" : "result"} from <b className="text-foreground">{s.tool_name}</b> (
              {s.content.length} chars)
            </summary>
            <Pre>{s.content}</Pre>
          </details>
        </div>
        {s.child && <RunCard tree={s.child} />}
      </>
    );
  if (s.kind === "error")
    return (
      <div className={cn(stepBox, "border-red-400 bg-red-50 text-red-900")}>
        <Label>error</Label>
        {s.content}
      </div>
    );
  return (
    <div className={cn(stepBox, "border-emerald-400 bg-emerald-50 whitespace-pre-wrap")}>
      <Label>answer</Label>
      {s.content}
    </div>
  );
}

function RunCard({ tree }: { tree: RunTree }) {
  const { run: r, steps } = tree;
  return (
    <Card className={cn("my-2.5 gap-0 border-l-4 px-3.5 py-3", (AGENTS[r.agent] ?? FALLBACK).edge)}>
      <div className="mb-1.5 flex flex-wrap items-baseline gap-2.5">
        <AgentBadge agent={r.agent} />
        <span className="font-medium">{r.task}</span>
        <span className="text-muted-foreground">
          · {r.status} · {dur(r)} · AI cost {money(r.cost_cents)}
        </span>
      </div>
      {steps.length ? steps.map((s) => <Step key={s.seq} s={s} />) : <div className="text-muted-foreground">starting…</div>}
    </Card>
  );
}

export function OpsRunPage({ tree, refresh }: { tree: RunTree; refresh: boolean }) {
  const r = tree.run;
  return (
    <OpsPage title={`${r.agent} run`} refresh={refresh}>
      <p className="text-muted-foreground">
        <a href="/ops" className="hover:underline">
          ← all check-ins
        </a>{" "}
        · day {r.sim_day} · {time(r.started_at)}
      </p>
      <RunCard tree={tree} />
    </OpsPage>
  );
}

export function OpsNotFoundPage() {
  return (
    <OpsPage title="Not found">
      <p>No such run.</p>
    </OpsPage>
  );
}
