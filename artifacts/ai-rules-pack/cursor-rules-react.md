# Cursor Rules — React/Next.js Stack

## Component rules
- Functional components only. No class components.
- Props typed with explicit interfaces, not inline types.
- Co-locate component, styles, and test in one folder.
- Use named exports. Never `export default` for components.
- Max component size: 150 lines. Extract sub-components aggressively.

## Hooks
- Custom hooks start with `use`. Live in `/hooks` or co-located.
- `useEffect` must have exhaustive deps. Disable with a comment explaining why.
- Data fetching via React Query or SWR — never raw `useEffect` for async.

## State
- Local state for UI-only state (`useState`).
- Zustand for cross-component state. No Context for frequently-updated values.
- Server state via React Query. Cache keys must be deterministic.

## Styling
- Tailwind CSS. No inline `style` props except for dynamic values.
- CSS variables for theme tokens. No magic numbers.
- Dark mode via `dark:` variant, not JS toggle.

## Next.js specific
- App router. Server components by default, `'use client'` only when needed.
- Route handlers for API. Never expose secrets to client.
- `next/image` for all images. Width and height always specified.
- Middleware for auth checks.

## TypeScript
- `strict: true` always.
- `@/` path alias for src root.
- Zod for form and API validation.
- Never `as any` — use type guards.

## Performance
- Dynamic import for heavy components.
- Memoize expensive computations with `useMemo`.
- Virtualize lists over 100 items.
