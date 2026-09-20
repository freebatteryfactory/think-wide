# T08 local setup follow-up — ready for adversarial QA

Issue #21; PR #29; integrated with main `76c193b`. The published branch was
updated by merging main, preserving its shared history without a force-push.
No dependency, lockfile, public contract, website or WorkOS changes.

## Accepted resolution of the original blocker

Convex npm/CLI **1.46.0** on the local self-hosted backend would not combine
internal invocation and CLI `--identity`: it reported `Could not find function`
for `snapshots:register`, although function-spec listed the internal function.
Without impersonation the old handler correctly rejected missing identity.
That draft stopped; it did not seed a portfolio.

The approved resolution is operator provisioning with an explicit **recipient**:
`internal.operatorProvisioning.{registerSnapshot,cacheSource,cacheHistory}`.
The operator CLI uses its existing local admin credential, without `--identity`.
The functions reuse T05's registration, validation, caching and grant checks.
Public caller identity still comes exclusively from verified authentication.
The narrow exception is recorded in AGENTS rule 1 and decision 0002.

A recipient must be a full `issuer|subject` identifier. Malformed identifiers
are rejected before writes. This is syntax validation, not proof that a recipient
exists at an identity provider: an authenticated operator intentionally chooses
who receives the snapshot. A public client cannot reach these functions with
any recipient string. Null auth inside an internal handler is not authentication;
Convex's internal function visibility supplies the administrative boundary.

Installed implementation inspected: `convex/src/cli/lib/run.ts`
(`runFunctionAndLog`) and `convex/src/browser/http_client.ts` (`setAdminAuth`).
Documented interfaces: [CLI run](https://docs.convex.dev/cli/reference/run) and
[internal functions](https://docs.convex.dev/functions/internal-functions).
Backend image used:
`ghcr.io/get-convex/convex-backend@sha256:1b0dcd93a3d126400d16e256aea1106a2ee9538882dda545d2c979f28cff1483`.

## Setup and repeatability

`bun run local:setup` requires non-production `local-demo`, a literal loopback
backend, matching deployment selectors in `.env.local`, and the existing private
local signing key. It accepts no arguments. It configures the public local JWKS,
pushes functions, verifies its JWT signature/issuer/audience, and checks a real
public handler before provisioning the committed alpha and beta Git bundles.

Successful live seeding cached **5 alpha blobs and 3 beta blobs, zero uncached**.
A subsequent run completed with the same snapshot ids and cache counts.
Existing `indexedAt` is retained so immutable registration digests match.
Revoked grants are not recreated. Each registration/cache write is transactional;
the whole setup is restartable, not one atomic transaction.

The real backend contained old grants to snapshots that were never registered.
These initially broke repeat setup's `listProjects` call after the first seed.
Project listing now skips missing snapshot rows after authorizing their grants,
retains bounded pagination, and omits missing resources from entries and scope.
Direct reads of a missing snapshot still return `not_found`. A regression test
covers ten orphan grants before the two real snapshots, including cursor traversal.
No existing grants or data were deleted to obtain a passing result.

Source cache input is bounded to **48 KiB per blob** to fit the CLI argument limit.
Larger blobs remain visible and uncached; exact reads report `source_unavailable`.
History caches the first **20 commits**, with its actual completeness flag.
These bounds cover the two committed demo bundles; this is not a general importer.

## Commands and observed results

Run from the `t08-local-setup` worktree on 2026-09-20:

- `bun install --frozen-lockfile`: exit 0; no dependency changes.
- `bunx convex dev --once`: exit 0; current local functions pushed (2.3 s).
- `bun run local:setup`: exit 0; repeat after the orphan-grant fix also exit 0.
- `bunx vitest run tests/domain/t08-local-setup.test.ts tests/domain/t08-provisioning.test.ts tests/domain/t06-boundary.test.ts`:
  exit 0; 23 tests across 3 files.
- `bunx vitest run tests/domain/t08-local-setup.test.ts tests/domain/t05-sources.test.ts`:
  exit 0; 13 tests across 2 files after the listing fix.
- `bun run typecheck`: exit 0.
- `bun tests/adapter/t08-local-live.ts`: exit 0; live acceptance below.
- `bun run verify`: exit 0; **584 tests across 39 files**, no skipped tests;
  frozen install, contract drift, Biome, TypeScript and production build passed.
  Build emits existing dependency `use client` directive warnings.

The explicit live script is separate from fixture CI because it requires a
running, seeded local backend and writes synthetic acceptance records. It does
not use admin credentials. The owner uses a real stdio MCP subprocess; the second
principal uses an SDK in-memory transport to the same real backend. Its second
JWT is test-only; the application issuer remains fixed-principal.

## Live SDK acceptance

`bun tests/adapter/t08-local-live.ts` verified:

- Exactly the generated **16 MCP tools**; owner sees alpha and beta; another
  principal sees zero projects and cannot read alpha source.
- Browse alpha and read `src/alpha.ts`; returned source equals the fixture bytes.
- Open/replay returns the same investigation; changed arguments conflict.
- Decision advances revision 0 to 1; replay returns the same decision;
  changed arguments conflict. The prior run reads superseded immediately.
- Late proposal is refused; a fresh admitted host run publishes a proposal and
  replays the same finding id.
- Prepare/read a brief preserves the human correction in its Markdown body.
- Each of the three provisioning functions is inaccessible through the public
  mutation API with no token, the owner's JWT, and the other principal's JWT
  (**nine rejection checks**).

Unit tests additionally verify malformed recipients cause no writes, all three
internal functions reject a user context, provisioning is absent from generated
operation/MCP inventories, revoked grants block reseeding, and repeat seeding does
not duplicate snapshots, entries or caches. No authorization is mocked.

## Actual local MCP host

**Claude Code 2.1.278** connected with an isolated strict MCP configuration,
using only the think-wide tools and no shell/edit tools. Its stdio server was
launched using `bun --no-env-file` with only local mode and loopback backend
configuration; admin credentials were not passed to the server.

Observed host calls: getCapabilities, listProjects, browseSnapshot (root and src),
readSource, openInvestigation, recordDecision, readInvestigation. Host process
exited 0, `is_error=false`, nine turns, zero permission denials. Capabilities
reported contract `0.4.0`, local fixed principal, no search modes, and unproven
hosted identity/GitHub/remote MCP integrations as `not_run`.

Independent JWT-authenticated read after the host exited verified investigation
`jx73nc9dmrffqjzwy667p8zc8n8er2x2` at revision 1 with decision
`jd7csq079psxymt5tqaww28x2h8esxef` and the exact correction:
“Preserve exact evidence and the human correction”. This checks persisted state,
not only the host's natural-language report. No token or private key is recorded.

## Scope and remaining work

**Status: local real handlers + live local MCP host over stdio.** All writes were
to the local Docker backend at `127.0.0.1:3210`: mode/public JWKS, function pushes,
synthetic snapshots/caches/grants and acceptance investigations/runs/briefs.
No key rotation, VPS, browser, hosted identity or remote MCP claim.

Future B remains design only: a public import job owned from verified identity,
a trusted Node reader, and job-gated completion using the same storage primitive.
A service JWT alone cannot call a Convex internal function; a future authenticated
worker entry point must verify service authority and the job before invoking it.
WorkOS/Pipes evaluation remains I01/I02 scope. Independent adversarial QA and
human approval by adiesh2 remain pending; this PR has not been merged.
