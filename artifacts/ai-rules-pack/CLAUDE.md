# Claude Code Rules — TypeScript/Node.js Stack

## Project conventions
- TypeScript strict mode always. No `any` unless explicitly suppressed with a comment.
- ESM modules (`"type": "module"` in package.json). Use `.js` extensions in imports.
- pnpm for package management. Never commit `node_modules`.
- Use `tsx` for running TypeScript directly. No build step for scripts.

## Code style
- 2-space indentation, single quotes, trailing commas.
- Functions over classes for utilities. Classes for stateful services.
- Prefer `const` over `let`. Never `var`.
- Named exports only — no default exports except for Hono routes.
- Keep functions under 40 lines. Extract helpers freely.

## Testing
- vitest for all tests. Files in `/tests` or co-located `.test.ts`.
- No mocking of database — use in-memory SQLite for tests.
- Every service function must have at least one test.

## Error handling
- Use `Result<T, E>` pattern for expected failures (not exceptions).
- Only throw for truly unexpected errors.
- Parse all external data with zod. Never trust JSON from LLMs without validation.

## LLM / AI
- All LLM outputs parsed with zod. Retry once on schema mismatch.
- Log every LLM call to the `llm_calls` table with token counts and cost.
- Use prompt files in `/src/agents/prompts/*.md`. Keep prompts diffable.
- Never hard-code model IDs — read from config.

## Security
- Secrets in `.env` only. Never commit `.env`.
- Validate and sanitize all user inputs at HTTP boundary.
- Use signed, expiring tokens for file downloads.
- Webhook signatures must be verified before processing.

## Git
- Commits: type(scope): description format.
- Never commit generated files (xlsx, sqlite).
- Branch per feature, squash on merge.
