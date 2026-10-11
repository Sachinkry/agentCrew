# How agentCrew uses Entire

Entire gives the coding agent (Claude Code) repository context in two ways:
**Checkpoints**, which save the session behind each change, and **entire-graph**,
which maps how the code is connected. Both are part of how this repo is built.

## Setup

```sh
entire login
entire enable --agent claude-code --import-history   # hooks + last 30 days of sessions
entire plugin install graph                          # entire-graph v0.4.0
entire graph init-agents --repo .                    # writes the graph guide into AGENTS.md / CLAUDE.md
```

`entire status` → `Enabled · branch main · Agents · Claude Code · Checkpoints sync to: origin`.
47 checkpoints on `main`, including imported sessions from the build so far.

## Checkpoints: every change keeps its why

Each commit made by the coding agent carries an `Entire-Checkpoint` trailer that links
it to the session, prompt and transcript that produced it:

```
0a5d854 fix: spend limit stops agents cleanly instead of failing the run
Entire-Checkpoint: 01M4PB8G1C850QM37F8VYCQZQJ

036fe66 chore: enable Entire session tracking for Claude Code
Entire-Checkpoint: 01M4PB8BWJXR3SB0KZVSFR705P
```

Imported checkpoints cover the earlier debugging sessions, where each fix came from
reading an agent's neatlogs trace, e.g. `01M4P8J0DW339X91J9E234BWD9` ("read the next
trace and fix").

Any line can be traced back to the prompt that caused it:

```
$ entire why src/core/budget.ts:36
  Line 36 in src/core/budget.ts
  export function isBudgetStop(err: unknown): err is TokenBudgetExceeded | SpendLimitReached {

  [MX] by Claude Code · claude-opus-5-5 · checkpoint 01M4PB8G1C850QM37F8VYCQZQJ · session 821ba888 · commit 0a5d8547
```

## entire-graph: locate first, check the blast radius, then change

Worked example, the spend-limit fix (`0a5d854`). Check-in 16's operator run was
marked **failed** when the LLM spend guard tripped.

1. **Locate:** `entire graph search --query "LLM spend budget reached stops model calls and fails the agent run"`
   ranked `chat()` in `src/core/model.ts` (where the guard throws) and `runAgent()` in
   `src/core/agent.ts` (where the run is marked failed).
2. **Impact:** `entire graph impact --symbol chat`:
   ```
   Blast radius: 4 callers (2 direct, 2 transitive), 9 callees, 6 type consumers, 5 data flows
   Callers: modelLoop (src/core/agent.ts) · callLlm (src/core/llm.ts)
            runAgent (via modelLoop) · callLlmParsed (via callLlm)
   ```
   Only `modelLoop` needs to treat the limit as a clean stop. For `callLlm`
   (claim verification), a thrown error already becomes a tool error.
3. **Test first:** `tests/spend-guard.test.ts` failed, then passed after the fix. All 71 tests pass.
4. **Verify the change set:** `entire graph checkpoint 01M4PB8G1C850QM37F8VYCQZQJ`:
   ```
   src/core/agent.ts   ~ function modelLoop body changed (1 dependent)
   src/core/budget.ts  + class SpendLimitReached added
                       + function checkSpend added
                       + function isBudgetStop added
   src/core/model.ts   ~ function chat body changed (2 dependents)
   tests/spend-guard.test.ts  + module added
   ```
5. **Real run:** check-in 17 at the limit ended `done` ("Stopped early: LLM budget
   reached…"), not `failed`, and used 0 tokens.

Graph index for this repo: 81 files, 734 symbols, 1,997 relations (CALLS, IMPORTS,
DATA_FLOWS, …), built locally with no network access.

## How the pieces fit

```
neatlogs trace of an agent run ──► failure found (e.g. Content cut off mid-job)
        │
        ▼
entire graph search / impact ──► the code behind it, and what a change would touch
        │
        ▼
failing test from the trace's real numbers ──► fix ──► green
        │
        ▼
commit with Entire-Checkpoint ──► next real run, compared in neatlogs
```
