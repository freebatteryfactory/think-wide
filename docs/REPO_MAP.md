# Repo map: exact paths

Where every file goes. **EXISTS** = in the repo now. **TOOL** = created by a scaffold command, do not hand-write. **Txx** = written by that ticket. Names marked TOOL may differ slightly by scaffold version; keep what the tool emits.

Import rule: `convex/` and `src/server/` may import `core/` and `generated/`. `convex/` never imports `src/`. `src/` reaches Convex only through `convex/_generated/api`. `core/` imports nothing but `generated/`.

## Root

| Path | Source |
|---|---|
| `.gitattributes` `.gitignore` `.env.example` | EXISTS |
| `README.md` `LICENSE` `CLAUDE.md` (agent instructions, shared by all three) | T01 |
| `package.json` `tsconfig.json` `vite.config.ts` | TOOL: TanStack Start scaffold |
| `bun.lock` | TOOL: `bun install` (only Eassa changes deps) |
| `components.json` | TOOL: `bunx shadcn@latest init` |
| `.env.local` | local only, gitignored, copied from `.env.example` |

## `contracts/` hand-written public contract (T02, Eassa). See decisions/0001

```
contracts/operations.json                   EXISTS  operationId -> request, response, envelopeKind, effect, handler(<convexModule>:<exportName>, optional), exposure(http|mcp), approval, ticket, ui(template, optional, MCP-exposed only); uiTemplates: template -> ui:// uri, title, description
contracts/schemas/common.schema.json        EXISTS  Id, CommitId, ObjectId, Sha256, Revision, Cursor, RequestKey, EvidenceClass
contracts/schemas/source-ref.schema.json    EXISTS  repo + full commit + blob + entryId + [start,end) bytes + digest
contracts/schemas/evidence.schema.json      EXISTS  readSource result: exact bytes, actual range served
contracts/schemas/envelope.schema.json      EXISTS  kind, scope, entries, coverage, nextCursor, freshness, truncated
contracts/schemas/requests.schema.json      EXISTS  one $def per operation input; identity is never a field
contracts/schemas/error.schema.json         EXISTS  code + message; forbidden and not_found must be indistinguishable
contracts/schemas/{capabilities,project,snapshot-entry,finding,investigation,decision,proposal,run,handoff,composition}.schema.json   EXISTS
contracts/schemas/commit-record.schema.json T05  entries for readHistory
contracts/schemas/recipe.schema.json        EXISTS  entries for readGuidance (T07, PR #15)
```
No `openapi.yaml` and no `operations.registry.ts`: the schemas plus `operations.json` are canonical.

## `generated/` output of `scripts/codegen.ts`, committed, never edited

```
generated/types.ts            EXISTS
generated/validators.js      EXISTS  Ajv standalone, ESM, no require(
generated/validators.d.ts    EXISTS
generated/operations.ts      EXISTS  OPERATIONS, OperationId, MCP_EXPOSED, CONTRACT_VERSION, OperationRequestMap, OperationResponseMap,
                                     Read/State/ExternalOperationId, OPERATION_HANDLERS, ImplementedOperationId, UNIMPLEMENTED_OPERATIONS
generated/mcp-tools.ts       EXISTS  MCP_TOOLS (one descriptor per mcp-exposed operation: name, description, operationId, effect, handler,
                                     self-contained inputSchema with local #/$defs refs only), MCP_TOOL_NAMES, McpToolName. Data only, no server.
                                     Bound tools carry _meta (ui.resourceUri + openai/outputTemplate); MCP_UI_RESOURCES, MCP_APP_MIME_TYPE, McpUiTemplate
```

## `core/` pure TypeScript rules (T06 Eassa, reviewed by Andrew)

```
core/index.ts
core/principal.ts      verified identity -> principal; never from request fields
core/grants.ts         object authorization, grant epoch
core/source-ref.ts     exact reference identity + digest check
core/revision.ts       investigation revision N -> N+1, stale fencing
core/receipts.ts       actor + operation + resource + request key + argument digest
core/decisions.ts      correction / constraint / rejection
core/handoff.ts        frozen brief revision, body hash, deterministic Markdown
core/audience.ts       destination visibility vs consumed sources
core/limits.ts         20 hits, 100 children, 16 KiB windows, scan caps
```

## `convex/` backend state (TOOL creates the folder; files by ticket)

```
convex/_generated/            TOOL: bunx convex dev
convex/tsconfig.json          TOOL
convex/schema.ts              T06  grants, investigations, decisions, receipts, runs (replaces scaffold todos); T05 adds repositories/snapshots/entries
convex/auth.config.ts         T02 scaffold, I01 real issuer/JWKS/audience
convex/lib/operation.ts       T06  THE pipeline: validate -> principal -> receipt -> handler -> validate response -> finalize (decisions/0002)
convex/lib/authz.ts           T06  requirePrincipal, loadAuthorized, queryAuthorized: the only access to protected tables
convex/projects.ts            T05  listProjects
convex/snapshots.ts           T05  browseSnapshot, entry index
convex/sourceCache.ts         T05  exact-byte cache by repo/snapshot/blob
convex/findings.ts            T07
convex/investigations.ts      T06  openInvestigation, readInvestigation
convex/decisions.ts           T06  recordDecision
convex/proposals.ts           T10  submitProposal, internal publication mutation
convex/runs.ts                T10  requestAnalysis, getRun, cancelRun
convex/handoffs.ts            T09  prepareHandoff, readHandoff
convex/receipts.ts            T06  ids + argument digest only, never response bodies
convex/actions/reasoning.ts   T10  "use node" internal action, one model call
```

## `src/` web app + trusted Node server

```
src/router.tsx                          TOOL
src/routeTree.gen.ts                    TOOL (generated, committed)
src/routes/__root.tsx                   TOOL, then T03
src/routes/index.tsx                    T09  portfolio
src/routes/projects.$projectId.tsx      T09
src/routes/investigations.$investigationId.tsx   T09
src/routes/handoffs.$handoffId.tsx      T09
src/routes/workshop.tsx                 EXISTS  T03  component workshop
src/routes/api/auth/callback.tsx        I01  WorkOS redirect (AuthKit serves /api/auth/callback, not /callback); 404 unless THINK_WIDE_IDENTITY=workos
src/routes/api/auth/sign-in.tsx         I01  redirect to hosted AuthKit; 404 unless THINK_WIDE_IDENTITY=workos
src/start.ts                            I01  request middleware: CSRF always, AuthKit only when THINK_WIDE_IDENTITY=workos
src/routes/api/ops.$operationId.ts      T08  HTTP adapter
src/routes/api/mcp.ts                   T08  MCP streamable HTTP endpoint

src/lib/utils.ts                        TOOL: shadcn
src/lib/identity-mode.ts                I01  "workos" | "none"; VITE_THINK_WIDE_IDENTITY (build) and the shared parser. A mode name, never a credential
src/integrations/convex/provider.tsx    TOOL, then I01  bare ConvexProvider (mode none) or ConvexProviderWithAuth (mode workos); no backend URL still renders
src/integrations/workos/provider.tsx    I01  AuthKitProvider, mounted only in mode workos
src/integrations/workos/convex-auth.ts  I01  useAuth adapter: the signed-in person's own access token -> Convex, null when signed out
src/components/ui/*                     TOOL: shadcn add
src/components/catalog/EvidencePair.tsx        EXISTS  T03
src/components/catalog/ConnectionCard.tsx      EXISTS  T03
src/components/catalog/ConstraintEditor.tsx    EXISTS  T03
src/components/catalog/HandoffPreview.tsx      EXISTS  T03
src/components/catalog/Stack.tsx               EXISTS  T03
src/components/catalog/Section.tsx             EXISTS  T03
src/components/catalog/registry.tsx            EXISTS  T03  closed component list -> fixed React bindings
src/components/catalog/validate-composition.ts EXISTS  T03
src/components/workshop/Workshop.tsx           EXISTS  T03  /workshop page: views, inspector, theme toggle
src/components/workshop/fixtures.ts            EXISTS  T03  synthetic sources and compositions (not Git observations)
src/components/workshop/state.ts               EXISTS  T03  view/draft state transitions, pure
src/components/shell/PortfolioNav.tsx          T09
src/components/shell/SourceViewer.tsx          T09
src/components/shell/AuthIndicator.tsx         I01
src/components/shell/ApprovalDialog.tsx        I03
src/styles.css                          EXISTS  TOOL, then T03  entry: imports only (Fontsource fonts, tailwindcss, the three files below)
src/styles/theme.css                    EXISTS  T03  colour/font tokens for :root and .dark; ratios enforced by tests/render/theme-contrast.test.ts
src/styles/globals.css                  EXISTS  T03  @theme mappings, base rules, focus outline
src/styles/workshop.css                 EXISTS  T03  workshop, catalog and home layout
                                        components.json still names src/styles.css as the Tailwind CSS file, so a `shadcn add` that
                                        injects CSS variables writes them there; move them into src/styles/theme.css before committing.

src/server/config.ts                    T02  mode: local-demo | connected; refuse local-demo in production
src/server/convex-client.ts             T06  request-scoped client, no global authed client
src/server/ops/dispatch.ts              T08  one path: validate -> authorize -> handler (HTTP + MCP + CLI)
src/server/ops/handlers/*.ts            T05..T09  one file per operationId
src/server/mcp/server.ts                T08  tools + static ui:// view resources (resources/list, resources/read), all from generated tables
src/server/mcp/apps/investigation.html  T08  read-only MCP Apps view of a readInvestigation result; self-contained, textContent only, no network
src/server/mcp/tools.ts                 T08  built from generated/mcp-tools.ts + generated/operations.ts, explicit exposure only; restates nothing
src/server/auth/workos.ts               I01  server identity switch (THINK_WIDE_IDENTITY); holds no credential
src/server/auth/verify-token.ts         I01  issuer, JWKS, audience
src/server/git/snapshot.ts              T05  resolve ref once -> full commit id
src/server/git/tree.ts                  T05  git ls-tree -z
src/server/git/read-blob.ts             T05  git cat-file, byte ranges, digest
src/server/git/history.ts               T05  bounded log/diff
src/server/search/literal.ts            T07  fixed-string over immutable bytes
src/server/search/structural.ts         T07  ast-grep, no rewrite flags, clean env, time/output caps
src/server/search/rules/*.yml           T07  reviewed rules
src/server/guidance/recipes/*.md        T07  readGuidance content
src/server/github/app.ts                I02
src/server/github/publish-issue.ts      I03
```

## `tests/` (Andrew; file names carry the acceptance ID from 05_SECURITY_AND_CI.md)

```
tests/fixtures/identities.ts            T04  principals A and B
tests/fixtures/repos/                   T04  two real git repos as .bundle files (byte-exact, see .gitattributes)
tests/fixtures/expectations.ts          T04  independent permission expectations
tests/helpers/effects.ts                T04  observe db/job/provider effects
tests/boundary/q01-cross-tenant.test.ts
tests/boundary/q02-token-profiles.test.ts
tests/boundary/q03-nested-refs-cursors.test.ts
tests/domain/q04-exact-bytes.test.ts
tests/domain/q05-search.test.ts
tests/domain/q06-stale-proposal.test.ts
tests/domain/q07-duplicate-command.test.ts
tests/domain/contract-rejects-nested-invalid.test.ts   EXISTS  contract 0.1.0 shapes, 12 cases
tests/domain/contract-0.2.0.test.ts     EXISTS  hash binding, invocable search modes, decision categories
tests/domain/decision-category.test.ts  EXISTS  #14 part 2: real recordDecision handler stores/returns category, replay, conflict, revocation
tests/domain/operation-handlers.test.ts EXISTS  registry handler bindings name real operation.query/mutation exports, none shared, none unbound
tests/domain/contract-ui-binding.test.ts EXISTS  contract 0.6.0: ui binding accepted; unknown template, extra properties, non-ui:// uri, non-MCP operation fail the real generator
tests/domain/mcp-tools.test.ts          EXISTS  MCP descriptors = mcp-exposed registry rows; inputSchema self-contained on a fresh strict Ajv and agrees with generated validators
tests/domain/t06-*.test.ts              T06  real handlers via convex-test, identities A and B
tests/adapter/q08-catalog-composition.test.ts   EXISTS  T03  closed catalog, exact refs, size/depth limits
tests/adapter/workshop-state.test.ts            EXISTS  T03  draft survives view changes and rejection
tests/render/catalog-smoke.test.tsx             EXISTS  T03  server-rendered bindings, escaping, label/help wiring
tests/render/theme-contrast.test.ts             EXISTS  T03  WCAG ratios for the token pairs in use, both themes
tests/boundary/q10-injection.test.ts
tests/boundary/q13-analyzer-confinement.test.ts
tests/adapter/q14-same-policy-all-surfaces.test.ts
tests/adapter/t08-mcp-app.test.ts       EXISTS  tools/list _meta = generated, resources/list + resources/read without a token, unknown uri -> SDK not-found
tests/structural/t08-mcp-app-widget.test.ts EXISTS  the view has no external reference, no eval, no HTML sink, no tool call
tests/browser/t08-mcp-app.browser.test.ts EXISTS  real Chromium under the MCP Apps default CSP: postMessage bridge + window.openai, hostile strings render as text, 320px, themes
tests/browser/workshop.browser.test.ts  EXISTS  real Chromium via playwright-chromium; own config (vitest.browser.config.ts), `bun run test:browser`; skips loudly without a browser
tests/e2e/q15-full-loop.test.ts         T11
```

## `scripts/` `infra/` `.github/`

```
scripts/codegen.ts                      EXISTS  contracts/ -> generated/ (validators, types, operations, MCP tool descriptors), no network, no model calls
scripts/check-drift.ts                  EXISTS  generate twice into clean dirs, compare recursively with committed generated/; docs/OPERATIONS.md must be current
scripts/operations-doc.ts               EXISTS  generated/operations.ts -> Markdown table; `--write` writes docs/OPERATIONS.md
package.json "verify" script           EXISTS  frozen install -> drift -> biome -> tsc -> vitest -> vite build (same entry local + CI)
vitest.config.ts                        EXISTS  plain Node env, no app Vite plugins
scripts/make-fixture-repos.ts           T04

infra/docker-compose.yml                EXISTS  Convex pinned by digest, 127.0.0.1 only
infra/Caddyfile                         I04
infra/docker-compose.prod.yml           I04
infra/DEPLOY.md                         I04  ports, volumes, SSH recovery

.github/workflows/ci.yml                T01  calls scripts/check.ts, actions pinned by SHA
.github/CODEOWNERS                      EXISTS  specialty owners; shared seams reviewed by Eassa + Andrew
```

## `docs/`

```
docs/*.md, docs/roles/, docs/tickets/   EXISTS  the plan (prior design material, disclosed)
docs/REPO_MAP.md                        EXISTS  this file
docs/OPERATIONS.md                      EXISTS  GENERATED by scripts/operations-doc.ts, never edited; stale copy fails verify
docs/G0_EVENT_RECORD.md                 G0   track, build window, organizer ruling, disclosure
docs/decisions/0001-contract-source.md  EXISTS
docs/decisions/0002-operation-pipeline.md EXISTS
docs/decisions/0003-decision-categories.md EXISTS
docs/evidence/                          sanitized receipts per ticket / Q-case
```
