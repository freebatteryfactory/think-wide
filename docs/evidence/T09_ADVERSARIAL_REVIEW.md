# T09 continuation: adversarial review and focused commits

Current state: [integrated T09 review](T09_INTEGRATED_REVIEW.md) supersedes the historical blockers below. T05/main are integrated; protected handoff persistence and source UI are implemented.
Date: 2026-09-20. **PARTIAL / BLOCKED for completion.** This is preparatory code, not ticket acceptance or trunk integration. Marc requested continuing independent T09 work until T05 merges, doing an adversarial review without CodeRabbit, and committing each logical change separately.

Branch: `feat/t09-persistent-workbench`, isolated worktree `/private/tmp/think-wide-t09`.
Draft PR: [#20](https://github.com/freebatteryfactory/think-wide-hackathon/pull/20).
Verified code: `48faaf301e006a9e5b750236b52426672d11ae70`.
T03 merge `73459b0` is an ancestor of this branch. Contract remains **0.1.0**.

## Focused commits and changed files

- `20c5588e9b2a16237972703405b25762f40f0921` — deterministic serialization, exact UTF-8 hash verification, strict decision command construction and history/navigation validation. Files: `core/handoff.ts`, `src/components/behavior/workbench.ts`, `tests/domain/t09-handoff.test.ts`, `tests/domain/t09-workbench.test.ts`.
- `90c04f2f6f6145af91d8dcda4d7c48cc39a40f20` — T03 theme and reviewed controls in the persistent editor; home entry form, workspace navigation, inert exact-reference metadata and findings. Files: `src/components/behavior/{DecisionEditor,InvestigationAccess,InvestigationEvidence,InvestigationWorkbench}.tsx`, `src/components/shell/PortfolioNav.tsx`, `src/routes/{index,investigations.$investigationId}.tsx`, `tests/render/t09-workbench.test.tsx`.
- `48faaf301e006a9e5b750236b52426672d11ae70` — pure snapshot-bound projection and export preparation with a fresh reader, pinned revision and hash check. Files: `core/handoff-projection.ts`, `src/components/behavior/{HandoffExport.tsx,handoff-export.ts}`, `tests/domain/t09-projection-export.test.ts`, `tests/render/t09-export.test.tsx`.

No T05 checkout edits, shared Convex/schema/contract changes, dependency changes, subagents, local CodeRabbit run, or bot-review request were made. The persistent editor uses T03's heading/theme/shadcn primitives; its workshop-only preview component remains intact.

## Adversarial review findings

Self-review, verified against the code and tests; no independent reviewer acceptance is claimed.

| Finding | Resolution and evidence |
| --- | --- |
| Equivalent JSON objects with different insertion order produced different brief bodies/hashes. | **FIXED `20c5588`**: canonical key ordering; equivalent-input regression. Arrays and exact strings preserve their order/content. |
| Spreading a runtime draft could replace the selected investigation or expected revision. | **FIXED `20c5588`**: project only `kind` and `statement`. Regression exercises the resulting command through real T06 handlers. |
| Empty or inconsistent continuation pages could be treated as usable history. | **FIXED `20c5588`**: generated page validation, contiguous revision checks, complete-ledger accounting and cursor/truncation consistency. Mixed revisions and duplicate decisions remain rejected. |
| UTF-8 conversion could silently replace lone surrogates; unsafe numeric byte ranges could misidentify evidence. | **FIXED `20c5588`**: lossless UTF-8 round trip and safe integer byte endpoints. Hash tests cover BOM, CRLF, multibyte text and invalid surrogate input. |
| Previously loaded history pages could remain visible after reconnection. | **FIXED `90c04f2`**: additional pages are tied to both the authorized first-page result and connection count. Authenticated reconnect behavior is **NOT RUN**. |
| Exporting a cached preview could bypass a fresh access check or export a different revision/body. | **PREVENTED `48faaf3`**: every export invokes its supplied protected reader with pinned ID/revision, validates the generated response and exact body hash, and compares all selection fields. No cached fallback; route remains unwired until a real protected read exists. Tests use fixture readers, not authorization mocks. |
| A pending export could complete after its selection changed or the component unmounted. | **PREVENTED `48faaf3`**: recheck selection and mounted state before starting clipboard/download side effects. Browser interaction acceptance is **NOT RUN**. |
| Source-derived HTML/Markdown could become executable UI or misleading reconstructed evidence. | **CHECKED**: React renders reference metadata as text; formatter uses safe literal fences; tests include hostile HTML and fence text. No source quotation or verified source existence is claimed. |

## Actual behavior and dependency boundary

The homepage accepts an existing investigation ID, validates it using the generated request validator, and navigates to the protected workbench. Decisions still use T06's real `readInvestigation` and `recordDecision`, preserving exact drafts, same-key uncertain-save replay, and explicit review before rebasing a stale draft. The UI displays finding provenance and exact reference metadata; it cannot yet read source bytes.

`projectHandoffInputs` consumes validated generated types and the complete decision ledger. It binds the requested revision and repository to exactly one investigation snapshot, preserves human constraints/rejections/corrections, includes consumed references and provenance, and refuses ambiguity, unavailable snapshots, foreign refs and over-cap evidence. It neither authorizes nor resolves branch names. The eventual protected transaction must authorize every referenced object, verify source existence, and supply stored IDs, timestamps, scope and acceptance metadata.

`HandoffExport` and its adapter are ready to consume a real saved brief operation. They are deliberately **not mounted** in a route: there is no protected `readHandoff` implementation or handoff storage in this branch. Copy/download implementation and hash fixtures are not a live export claim. Existing workbench preparation/publication controls remain visibly disabled with the dependency stated.

| Requirement | Status |
| --- | --- |
| Correction and prior rejection survive reread, without an LLM | **DONE — local real handlers.** Existing persistence/replay tests remain passing. |
| Correction and rejection survive authenticated browser reload | **PARTIAL** — command and route implementation; browser acceptance **NOT RUN**. |
| T03 controls/theme and investigation navigation | **DONE in code and SSR fixtures**; narrow-layout, dual-theme and authenticated interaction checks **NOT RUN** for this continuation. |
| Deterministic brief including base commit, constraints, refs, scope, uncertainty, acceptance and hash | **PARTIAL** — formatter and pure snapshot projection done; trusted transaction/persistence/source verification missing. |
| Saved brief copy/download | **PARTIAL** — adapter/component implemented and fixture-tested; protected reader and route wiring blocked. |
| Exact ranged `readHandoff` | **NOT DONE** — shared contract work remains. Current formatter refuses a whole serialized response above 16 KiB, without truncation. |
| Unsupported issue publication visibly disabled | **DONE in code and SSR fixtures**; formatter/adapter refuse wider audiences. |
| Real two-repository source-backed loop | **NOT DONE** — T05/shared handoff infrastructure/I01 and subsequent T10/T11 integration remain. |

## Blockers and next integration steps

1. **T05 PR [#23](https://github.com/freebatteryfactory/think-wide-hackathon/pull/23), open at `59806e078c98fdddcb997ca8fbd44379e0648c41`.** Its stated API provides `listProjects`, `browseSnapshot`, `readSource`, `readHistory` and source-reference validation. It also changes `convex/lib/{operation,authz}.ts`, `convex/schema.ts` and generated bindings. Wait for integration before consuming these operations and adding the project/snapshot selection and exact source viewer. No unmerged code was imported.
2. **Shared handoff infrastructure.** T05 does not itself provide handoff persistence. Coordinate the handoff table, authorized accessor, operation unions, receipt/replay result support and generated bindings with the shared-file owner, then add `convex/handoffs.ts` through the single operation pipeline. Freeze the complete authorized ledger/target at `expectedRevision` in one transaction, reauthorize replays and reads, then mount `HandoffExport` with the protected reader.
3. **Contract owner / ranged reads.** Contract PR [#18](https://github.com/freebatteryfactory/think-wide-hackathon/pull/18) remains open. Coordinate the exact ranged handoff response before changing shared schemas. Categories from accepted decision 0003 await generated/backend support; this slice cannot silently accept or discard an unsupported category.
4. **I01 / browser identity.** The app still has a bare `ConvexProvider`, without verified browser-login integration. Configure the actual local service and verified identity, remount user-scoped state on principal changes, then prove save → reload, stale revision, revoked-access read/export and same-key retries in the browser. No fallback identity or auth bypass was introduced.

## Exact commands and results

Commands ran in the isolated worktree. Bun commands used `env PATH=/Users/marcandy/.bun/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`.

- `bun run test -- tests/domain/t09-handoff.test.ts tests/domain/t09-workbench.test.ts tests/domain/t09-projection-export.test.ts tests/render/t09-workbench.test.tsx`: **exit 0, 39 passed across four files**, before the final SSR test split.
- `bun run typecheck`: **exit 0**.
- `bunx biome check --write tests/render/t09-workbench.test.tsx tests/render/t09-export.test.tsx`: **exit 0, two files checked, no changes**.
- `bun run test -- tests/render/t09-workbench.test.tsx tests/render/t09-export.test.tsx`: **exit 0, five passed across two files** after the split. Final T09 total is **40 tests** across five files.
- `bun run verify` at `48faaf3`: **exit 0**. Frozen install, no contract drift (four generated files regenerated twice), Biome (95 files), TypeScript, **320 tests passed / 25 skipped / 22 test files passed**, and client/SSR/Nitro production builds. The 25 existing Q13/structural analyzer skips require an unavailable isolation profile and are **NOT RUN**.
- `git diff --check` and `git diff --cached --check` for each focused commit: **exit 0**. Git hooks report the absent `.pre-commit-config.yaml` and skip that hook; the explicit full verify gate was run.
- `git fetch upstream`: **exit 0**, latest `upstream/main` is `3212004`. The two newer upstream documentation/CODEOWNERS commits have not been merged here; T03 code is integrated.
- `git merge-base --is-ancestor 73459b0 HEAD`: **exit 0**, proving T03 is included.
- `gh pr list --repo freebatteryfactory/think-wide-hackathon --state open --json number,title,headRefName,url` and `gh pr view 23 --repo freebatteryfactory/think-wide-hackathon --json state,isDraft,title,body,files,headRefOid`: **exit 0**; T05 #23 and contract #18 remain open.

**Status level:** decision commands = **local real handlers**; projection, exact body export and UI render = **fixtures only**. New browser smoke, authenticated browser acceptance, live source-backed handoff export, live provider/host and deployment = **NOT RUN**. The earlier disconnected-route smoke is documented separately in `T09_LOCAL_REVIEW.md`.

Assumptions and limits: no usable issued T09 base was found, so work continues on the previously approved isolated branch; no authentic source or account data appears in fixture output. Source metadata is not proof of source availability. A hash is integrity, not authorization. Unsaved drafts remain memory-only. Ranged reads, persisted handoffs, principal-switch behavior and source-backed browser acceptance remain real blockers, not waived requirements.
