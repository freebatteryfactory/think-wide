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
- Contract 0.1.0 froze at `2bb940f` (PR #6). Main established **0.2.0** (issue #10). T09 advances this branch to **0.3.0** because `prepareHandoff` now returns a bounded summary and `readHandoff` supports summary/full/body representations (details below; contract review by @heyoub).
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
| Exact ranged handoff body reads | T09 | Implemented in this branch: immutable summary plus pinned, reauthorized 2 KiB UTF-8 windows; complete body hash checked after reassembly. Unranged full responses still obey 16 KiB. |
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

## T09 handoff response changes (0.3.0, review in PR #20)

`prepareHandoff` freezes a new immutable handoff ID at revision 1 and returns a
`HandoffSummary` containing its investigation revision, exact target base, audience,
SHA-256, UTF-8 byte length and timestamp. Retrying its request key rereads that saved
ID under current grants, even after newer investigation decisions. A new request key
creates a separate frozen brief; no existing brief or human decision is rewritten.

`readHandoff` defaults to the existing full `Handoff` representation. `detail: summary`
returns the same summary. `detail: body` requires `handoffRevision` and `[start,end)`
`byteRange`, and returns a `HandoffBodyWindow`: exact content, actual range, immutable
ID/revision/hash/total size and a nullable `nextRange`. Body windows serve at most
2048 UTF-8 bytes, retract a server-selected end to a character boundary, and reject
caller-selected split characters, inverted ranges and out-of-bounds ranges. No byte
is silently omitted. JSON escaping still fits the common 16 KiB response cap.

Every summary, body window, full read and receipt replay rechecks the parent
investigation, all frozen snapshot grants, indexed evidence identities and exact
source digests. Missing and foreign handoffs have the same `not_found` result.
Unavailable/corrupt cached source fails closed. Client export rereads the summary,
checks each contiguous pinned window, then verifies SHA-256 over the complete exact
UTF-8 Markdown before copying or downloading. All registry bindings and validators
are regenerated; MCP discovers the two operations through the existing dispatcher.

Preparation is private-download only, consumes the complete ledger (maximum 256
human decisions and existing 32 constraint/evidence caps), and preserves categories.
The existing 65,536-character body limit remains. Oversized bodies/ledgers and
ambiguous targets are rejected atomically without a handoff or receipt. Referenced
source windows must each be at most 16 KiB. File-level allowed scope is explicitly
unspecified and requires specialist confirmation; acceptance is always `not_run`.
No model, issue publication, provider call or target code execution is introduced.

## Contract 0.3.0 additions from the PR #20 review

- `HandoffConstraint.kind` gains `acceptance`. Every human decision reaches the structured brief, with its optional `category`; `rejection` is still rendered as `rejected_approach`. Before this, acceptance decisions existed only inside the Markdown body, so a reader of `detail: "full"` (for example an MCP host) never saw them.
- `HandoffTarget` requires `hashAlgorithm`, and `baseCommit` length is bound to it (sha1 = 40 hex, sha256 = 64), the same rule as `SourceRef` and `SnapshotSummary`. The projection takes it from the algorithm-checked snapshot.

## Contract 0.4.0 (merge of T09 and T10)

The contract is 0.4.0 = 0.3.0 (T09 brief shapes) + host admission and proposal submission (T10). The T10 section below was authored as additive 0.2.1 before 0.3.0 landed; its behavior is unchanged.

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

## Contract 0.5.0: shared public demo catalog (F)

`claimDemoAccess` is a state operation exposed through HTTP and MCP. Its only
request field is `requestKey`; the caller comes from verified identity. It claims
reader access to the internally published public catalog and returns the existing
`projects` envelope. Generated operation bindings, descriptors, validators and
request/response maps are the only adapter inventory changes.

The catalog contains at most eight snapshots, matching the envelope scope bound.
The ordinary 16 KiB response cap still applies: excessive project metadata rolls
back the whole claim rather than silently omitting entries. There is no catalog
pagination. A new request key sees catalog additions; receipt replay returns its
original snapshot set and rechecks current authorization and catalog epochs.
This operation shares immutable sources, never investigations, decisions or briefs.
