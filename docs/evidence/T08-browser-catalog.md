# T08 lane A: automatic browser catalog claim

The authenticated portfolio invokes generated `api.catalog.claimDemoAccess`
before mounting its project query. It sends only a generated request key; identity
is still verified by Convex. One in-memory request key and completion promise live
under the current authenticated provider subtree. No JWT, principal, response body
or browser storage is added.

The portfolio waits for Convex's `isLoading`/`isAuthenticated` state. It does not
unmount during `isRefreshing`, preserving the current question and selection.
The installed Convex **1.46.0** implementation and API documentation in
`node_modules/convex/src/react/ConvexAuthState.tsx` distinguish initial server
confirmation from refreshing a previously confirmed token. The WorkOS **0.11.1**
`useAuth` user ID keys the Convex provider solely to reset its auth state, catalog
session and all descendant UI on account changes. Convex's new provider starts
with unconfirmed auth and waits for backend acceptance; the ID is never authority
or an operation argument. Normal hosted sign-in/sign-out still uses redirects.

StrictMode cleanup/setup attaches to the same pending promise. Successful claims
are reused during portfolio navigation. Failure is retained, never automatically
retried; the explicit retry button reuses the request key. A separate continue
button permits reading existing authorized repositories if catalog enrollment is
unavailable. Existing investigations and briefs have no catalog dependency.
Revocation still applies on every backend read and receipt replay.

## Verification

- `bun install --frozen-lockfile`: exit 0; no dependency changes.
- `bunx vitest run tests/render/i01-identity.test.tsx`: 20 passed, covering existing
  unsigned/loading states, no-backend rendering and identity-mode-none startup
  without invoking WorkOS.
- `bunx vitest run tests/domain/t08-browser-catalog.test.ts`: 1 passed using real
  Convex handlers. Duplicate setup yields one receipt; only requestKey goes on
  the wire; revocation removes visibility; explicit retry is denied and automatic
  retry never occurs.
- `bunx vitest run --config vitest.browser.config.ts tests/browser/t08-catalog-claim.browser.test.ts`:
  4 passed in headless Chromium. StrictMode completion, stable retry/navigation
  key, explicit failed-claim controls, late A completion after switching to B,
  query-after-claim ordering and draft/selection preservation during authenticated
  refresh. This is a standalone component harness with controlled view transport
  and auth presentation, not a mocked backend authorization result. Early harness
  attempts failed because standalone Vite loaded TanStack server-only code; the
  final harness isolates that configuration without changing application auth.

Full gate result is appended after completion. No backend, VPS or hosted WorkOS
user was changed. Status: **local real handlers + local browser component tests**.
Deployed automatic claiming and a real hosted account-switch flow are NOT RUN here.
