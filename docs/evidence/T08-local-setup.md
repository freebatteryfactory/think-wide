# T08 local setup follow-up — PARTIAL

Base: `ecd0be2`. Scope: issue #21 items 1, 3, 4 and 5. No website, HTTP,
WorkOS, dependency, contract or authorization changes.

## Installed API blocker (local self-hosted backend)

- Convex npm/CLI: **1.46.0**.
- Backend image:
  `ghcr.io/get-convex/convex-backend@sha256:1b0dcd93a3d126400d16e256aea1106a2ee9538882dda545d2c979f28cff1483`.
- Installed implementation inspected: `convex/src/cli/lib/run.ts`
  `runFunctionAndLog`, and `convex/src/browser/http_client.ts` `setAdminAuth`.
  CLI `--identity` uses `setAdminAuth(adminKey, identity)`, then `/api/function`.
- Official documented route: [CLI run](https://docs.convex.dev/cli/reference/run)
  and [internal functions](https://docs.convex.dev/functions/internal-functions).
  The CLI documents `--identity`; internal functions document CLI invocation.
  Installed `setAdminAuth` documents both internal invocation and acting as identity.
- `bunx convex dev --once`: **exit 0**, functions ready, 2.18 seconds.
- `bunx convex function-spec`: **exit 0**; lists
  `snapshots.js:register` with visibility `internal`.
- `bunx convex run snapshots:register '{}' --identity
  '{"subject":"local-developer","issuer":"http://127.0.0.1/think-wide-local"}'`:
  **exit 1**, `Could not find function for 'snapshots:register'. Did you forget to run npx convex dev?`
  Its available-functions list nevertheless includes `snapshots:register`.
- Same CLI call without `--identity`: **exit 1**, reaches `registerSnapshot`
  and returns contract `unauthenticated`, `Authentication required`.
- `bun run local:setup`: **exit 1** at fixture ingestion. Its actual public
  JWT-authenticated `getCapabilities` preflight succeeded before that failure.

Stopped after this documented route failed. No alternative admin wire protocol,
public seed function, supplied principal argument or authentication bypass was added.
The draft does **not** unlock a real seeded MCP portfolio yet.

## Changes and tests

The setup uses the existing private issuer, configures its public JWKS and local mode,
pushes Convex, verifies its JWT signature/audience/issuer, and calls a real public
handler before trusted operator ingestion. CLI impersonation is explicitly an operator
facility in `scripts/`, not public user authentication. Provided credentials remain
in `.env.local` and CLI output is suppressed to avoid leaking arguments or credentials.
Both process configuration and the CLI's explicitly selected `.env.local` are checked
for matching loopback configuration; conflicting deployment selectors are refused.

Fixture ingestion uses the existing Git reader and internal handlers. Replays retain
original `indexedAt` from currently authorized project metadata, so immutable
registration digests remain identical. Existing revoked grants are never recreated.
Source cache input is bounded to 48 KiB per blob to stay below the operating system's
single-argument limit after Convex base64 encoding. Larger blobs remain visible and
uncached; exact reads then report `source_unavailable`. Repository history caches the
bounded first page, with its actual completeness flag. These are explicit draft
limitations, not silently complete ingestion.

Real-handler test: repeated seeding creates two snapshots, two owner grants and two
history records without duplicate entries/cache rows; exact alpha source matches the
fixture bytes; another principal cannot read it; revocation prevents setup replay.
Subprocess tests reject production, connected, non-loopback, unset mode and supplied
arguments before contacting a backend. Recursive handler scan has a temporary-directory
probe proving nested paths are retained and `_generated`/`lib` are excluded. Q14 chooses
an unimplemented MCP operation using generated inventory and request validation.

## Gate results

- `bun install --frozen-lockfile`: exit 0, no lockfile or dependency changes.
- `bun run typecheck`: exit 0.
- `bun run test tests/domain/t08-local-setup.test.ts`: exit 0, 1 real-handler test.
- `bun run test tests/adapter/t08-local-setup-config.test.ts tests/domain/operation-handlers.test.ts`:
  exit 0, 22 tests.
- `bun run verify`: exit 0, **28 files / 487 tests passed**, zero skipped,
  contract drift check, Biome, TypeScript and production build passed.

## Local backend side effects

Only the local Docker backend at `127.0.0.1:3210` was used. Setup set backend
`THINK_WIDE_MODE=local-demo` and `THINK_WIDE_LOCAL_JWKS` from the existing local signing
key copied privately from the original checkout. It then pushed main's Convex functions.
No new key rotation, grant, snapshot, source-cache row or public function was introduced
by the failed live ingestion. No VPS or hosted identity setting was touched.

## Status levels

- Fixture ingestion and negative guards: **local real handlers via convex-test**.
- Local issuer + real backend public JWT preflight: **local real backend**.
- Complete local setup and seeded MCP stdio portfolio: **NOT DONE** (blocker above).
- Remote MCP, hosted identity, deployment, browser: **NOT RUN**.
