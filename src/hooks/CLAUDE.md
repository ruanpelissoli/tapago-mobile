# src/hooks/ — shared React hooks

## Purpose
Reusable stateful logic. Currently just `useAuth.tsx`, which owns the app's auth state
and is what every route guard reads.

## useAuth.tsx

### Key decisions
- **React Context, no state library.** Auth state is one small object read by two
  layouts. Redux/Zustand would be pure overhead at this size; this is a deliberate
  milestone choice, not an oversight.
- **Provider and hook live in the same file.** They are a single unit — splitting them
  invites importing one without the other and creates a needless import cycle.
- **`useAuth` throws when used outside the provider** rather than returning a default.
  A missing provider is a wiring bug that should fail loudly and immediately, not
  silently render every screen as signed-out.
- **`isRestoring` is a distinct flag, not `user === undefined`.** Callers shouldn't have
  to encode "null means signed out, undefined means still loading" — an explicit boolean
  is much harder to misread, and misreading it causes a visible auth flash.

### Business logic / invariants
- `isAuthenticated` is derived strictly from `user !== null`. Never set it independently
  — two sources of truth for "is signed in" is exactly how auth bugs happen.
- **`isRestoring` starts `true` and settles to `false` exactly once**, after the restore
  attempt. Consumers must render a loading state while it is `true`; see `app/CLAUDE.md`.
- The context value is memoised. Without it every provider render produces a new object
  and re-renders every guard in the tree.

### Dependencies
React only. Consumed by `app/_layout.tsx` (mounts the provider) and both group layouts.

### Gotchas
- **This is an in-memory stub.** `restoreSession` always resolves to `null` and `signIn`
  takes a user object directly — there is no network call and no token storage yet. The
  app therefore starts signed out on every launch, which is expected right now.
- `restoreSession` is the single intended seam for real persistence
  (`expo-secure-store`). Replacing its body should be sufficient; no consumer changes.
- The `isMounted` ref guards against setting state after unmount during Fast Refresh.
  Keep it when making `restoreSession` genuinely async.
- File is `.tsx`, not `.ts` — it returns JSX from the provider.
