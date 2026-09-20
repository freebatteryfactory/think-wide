# 0001: JSON Schemas + operations.json are the canonical contract

Date: 2026-09-20 · Owner: Eassa · Status: accepted · Supersedes the "authored OpenAPI" wording in 04_BUILD_CONTRACT.md

## Decision
The public contract is authored as JSON Schema 2020-12 files in `contracts/schemas/` plus one operation registry, `contracts/operations.json`. `scripts/codegen.ts` generates `generated/{types.ts,validators.js,validators.d.ts,operations.ts,mcp-tools.ts}`. There is no hand-written `contracts/openapi.yaml` and no `contracts/operations.registry.ts`. If HTTP documentation is needed, an OpenAPI document is emitted from the registry; it is never a second source.

## Why
04_BUILD_CONTRACT.md allows a reviewed adjustment when installed tools require it. One source feeds five consumers with the tools actually installed: Ajv strict validators, TypeScript types, the operation pipeline (0002), MCP tool input schemas, and the drift check. A hand-written OpenAPI file would be a second copy of the same nested shapes.

## Rules that follow
- `generated/` is committed and only ever regenerated (`bun run codegen`). `bun run verify` fails on drift.
- Generated validators are ESM with no `require(`; generation throws otherwise.
- A new operation is not agent-exposed unless `"mcp"` is in its `exposure` list.
- Identity is never a request field. Every request schema is `additionalProperties: false`.
- Operations that return the result envelope declare `envelopeKind`; the pipeline rejects a response whose `kind` differs.
- Every integration in `getCapabilities` reports an explicit status. Unproven means `not_run`, never absent.
- Contract 0.1.0 froze at `2bb940f` (PR #6). The current version is **0.2.0** (issue #10). It is 0.2.0 rather than 0.1.1 because response shapes change.
- The registry carries handler bindings and typed operation maps; adapters and wrappers consume them rather than restating them. An operation's optional `handler` is `"<convexModule>:<exportName>"`; `generated/operations.ts` exports `OperationRequestMap`, `OperationResponseMap`, `ReadOperationId` / `StateOperationId` / `ExternalOperationId`, `OPERATION_HANDLERS`, `ImplementedOperationId` and `UNIMPLEMENTED_OPERATIONS`. `convex/lib/operation.ts` takes its request/response types and effect unions from there. `tests/domain/operation-handlers.test.ts` fails if a handler does not name a real exported `operation.query(` (read) or `operation.mutation(` (state) registration with the same operationId, if two operations share a handler, or if a public registration is left unbound.
- MCP tool list, HTTP dispatch and any CLI are table-driven from `generated/operations.ts` and `generated/mcp-tools.ts`. An adapter that restates an operation's name, description, schema, effect, exposure or handler by hand is a defect. HTTP and CLI need nothing generated beyond the operation table, handler bindings, typed maps and validators. `generated/mcp-tools.ts` is data only (`MCP_TOOLS`, `MCP_TOOL_NAMES`, `McpToolName`): one descriptor per operation whose `exposure` includes `"mcp"`, whose `inputSchema` is the request schema bundled self-contained. Every referenced definition is hoisted into the descriptor's own `$defs` (`file#/$defs/X` as `X`, a whole file as its `title`, any other pointer as `<Title>_<segments>`), every `$ref` is `#/$defs/<Name>`, recursion stays a ref, and only `$id`, `$schema` and the nested `$defs` of a hoisted target are dropped. A top-level `type: "object"` is added only where every union branch already requires an object (`SearchSourcesRequest`). Generation fails on a name collision, an unknown `$`-keyword, or a bundle that does not compile alone under strict Ajv. `tests/domain/mcp-tools.test.ts` holds each bundle to the verdicts of `generated/validators.js`.
- `docs/OPERATIONS.md` is printed from `generated/operations.ts` by `scripts/operations-doc.ts`. It is never edited; `scripts/check-drift.ts` fails the gate when it is stale.

## What changed in 0.2.0
- **Object id length is bound to `hashAlgorithm`.** `SourceRef` (`commit`, `blobId`) and `SnapshotSummary` (`commit`, `rootTreeId`): `sha1` requires exactly 40 hex characters, `sha256` exactly 64, expressed as `if`/`then`/`else` so the generated `SourceRef` type stays a single interface. `hashAlgorithm` names the Git object format of those ids; `digest` is always sha256 and has its own field. T07's search had conflated the two (it stamped `sha256` on 40-hex ids) and was corrected when the constraint landed. `HandoffTarget.baseCommit` has no `hashAlgorithm` beside it and keeps the 40-or-64 pattern.
- **`Capabilities.searchModes` lists only invocable modes**: `literal`, `structural`. A mode is re-added together with its `SearchSourcesRequest` branch.
- **Decision categories** (decision 0003, issue #14): `common.schema.json#/$defs/DecisionCategory` = `architecture | security`; optional `category` on `Decision`, `RecordDecisionRequest` and `HandoffConstraint`. Never required, never `null`, nothing in `composition.schema.json`. `recordDecision` stores and returns it.
- **`recipe.schema.json`** is the entry schema for `readGuidance` (T07, PR #15).
- **Registry**: optional `handler` per operation; generated typed maps and effect unions (rule above).
- **`scripts/check-drift.ts` recurses** into `generated/`, treats a file/directory mismatch or an extra path as drift, and checks `docs/OPERATIONS.md`.

## Open items carried by their owning tickets
| Item | Owner | Interim rule |
|---|---|---|
| `readHandoff` needs an exact ranged body read (brief up to 64K chars vs 16 KiB result cap) | T09 | `prepareHandoff` refuses an over-cap brief with `limit_exceeded`. Never truncate. |
| Entry schema for `readHistory` | T05 | Implemented by `commit-record.schema.json`; first-parent metadata and bounded changed paths, enforced by the operation pipeline |
| Reject inverted byte/line ranges | T05 `readSource` handler | JSON Schema cannot express end >= start |
| Source ref existence (PR #12 review) | T05 integration (#11) | Resolve the indexed snapshot/entry and verify repository, commit, blob and byte bounds. Exact reads verify digests; metadata checks alone never promote findings to bytes_verified. |
| `src/server/config.ts` (mode, refuse local-demo in production) | T02 part 2 | — |
| `ScanEntry` (T07 search input) carries no `hashAlgorithm`; search derives it from the commit id length | T05, when it produces real entries | a ref whose `commit` and `blobId` lengths disagree is rejected by the validator |

## Closed in 0.2.0
- [x] Object id length must match `hashAlgorithm` (issue #10). The T05 git reader should still reject a mismatch early with `invalid_request`; the validators now reject it regardless.
- [x] `searchModes` no longer lists `semantic` / `type` (issue #10).
- [x] Optional `category` on `Decision`, `RecordDecisionRequest`, `HandoffConstraint` (issue #14 parts 1 and 2). UI (part 3) and end-to-end (part 4) remain with issue #14.
- [x] Entry schema for `readGuidance` (T07, PR #15).
- [x] `scripts/check-drift.ts` recurses.

## T05 history entry behavior

`readHistory` now validates every entry as generated `CommitRecord`. It reports pinned
first-parent commits, all parent IDs, subject, timestamp, first-parent comparison ID
(null for roots), and exact changed paths. Limits reject oversized records rather than
shortening source-derived text; bounded prefixes remain explicitly partial. No request
shape or decision category is changed. Contract review remains with @heyoub.

## Additive 0.2.1: explicit host admission (T10a, issue #28)

`beginHostRun` is a state operation exposed through HTTP and MCP. It reuses the
existing `RequestAnalysisRequest` admission shape and returns `Run`, but fixes the
driver to `host` and never dispatches a model call. The existing `requestAnalysis`
operation remains HTTP-only and fixes its driver to `backend`. Both use the same
atomic admission, revision and grant-epoch fences; at most one active run exists
per investigation revision. A host-supplied budget is declarative, not enforcement
of the external host's model spending.

`submitProposal` is now bound to the shared Convex operation pipeline. Public
submission requires a `runId` admitted by the same verified caller with driver
`host`; omission is `invalid_request`. The general Proposal schema remains
unchanged. Nested investigation, run and source references are authorized before
receipt replay, and publication rechecks the admitted revision and grant epochs.
Hosts should admit before reading the evidence they reason over. An admission
fence does not attest any earlier reads or model work.

This initial slice rejects compositions and nonempty claim `unknowns` with
`unsupported`, rather than discarding data without a durable representation.
Claim statements longer than Finding's 512-character summary limit are rejected
with `limit_exceeded`; findings stay `unverified`. Public fence rejection throws
and rolls back all writes. Internal publication returns its rejection outcome so
its `superseded` status persists. Human decisions already supersede current active
runs in their own transaction. No scheduler or provider call is added.
