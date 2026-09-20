# T09 integrated workbench and saved brief review

2026-09-20. Branch `feat/t09-persistent-workbench`; [PR #20](https://github.com/freebatteryfactory/think-wide-hackathon/pull/20). **REVIEW**: source integration and handoff persistence are implemented; acceptance/integration into main remains the reviewer's decision. This supersedes the blocker statements in the earlier T09 receipts.

## Commits and current foundation

- `93d089ab7d008b42af8bcc23c833b0d2dd052abf`: merged upstream main `ecd0be2`, including T05 #23, contract 0.2.0 #18 and T08 #24. T03 is also included. No conflicts; the user's main checkout and untracked notes were preserved.
- `7b126aa`: preserve existing decision categories through commands/briefs and update old contract assumptions. Category selection UI remains a separate follow-up per `Marc-ticket-notes.md`.
- `1784e51`: protected handoff persistence, contract 0.3.0, exact ranged reads, export reassembly and real-handler/contract regressions.
- `1af6a6f`: project/snapshot/source UI, source-backed decisions, prepare/save/reopen/copy/download wiring. This is the verified code commit; the following receipt commit changes documentation only.

No local CodeRabbit run or subagent was used. Adversarial self-review preceded the commits. No deployment, source ingestion into a live backend, hosted auth change or live browser acceptance was performed.

## Behavior and requirement status

| Requirement | Status / evidence |
| --- | --- |
| Current main, T03 and merged T05/T08 included | **DONE**: merge and commit ancestry. |
| Project/snapshot selection and exact source browsing | **DONE in code**: protected `listProjects`/`browseSnapshot`/`readSource`, bounded pages, UTF-8 byte ranges/digests, no reconstructed quotes. Source verifier exercised against real Git fixture reads. Browser interaction is **NOT RUN**. |
| Correction/rejection persist independently of a model | **DONE at local real-handler level**: existing command/replay/reread tests plus two-repository source-backed decisions. |
| Exact refs attached to durable decisions | **DONE**: verified source window attachment, generated request validation, backend indexed-reference authorization. |
| Protected handoff persistence and replay | **DONE at local real-handler level**: one existing operation pipeline, immutable row, receipt contains ID/digest only, expected revision, all input grants and source digests checked. |
| Deterministic brief: base, constraints, refs, uncertainty, scope, acceptance, hash | **DONE at local real-handler level**: both actual fixture Git identities preserved, corrections/rejections/categories retained. Scope is explicitly unconfirmed at file level; acceptance says `not_run`, not invented test results. |
| Large brief export | **DONE at local real-handler level**: summary + exact bounded body windows, complete client reassembly/hash, no response-cap bypass or truncation. |
| Reopen saved brief and copy/download UI | **DONE in code**: `/handoffs/$handoffId` rereads protected summary; each export rereads the pinned body. Actual clipboard/download browser actions **NOT RUN**. |
| Unsupported issue publication | **DONE**: disabled controls, wider audiences rejected by protected mutation/export. |
| Authenticated browser reload / deployed full loop | **NOT RUN**: I01 browser identity is not part of this integration. T08 supplies local stdio identity, not a browser session. The existing browser provider still needs verified identity configuration. |

## Changed areas

- Canonical contract: `contracts/operations.json`, request schema and new handoff summary/read schemas; `generated/` and `docs/OPERATIONS.md` regenerated.
- Persistence: `convex/handoffs.ts`, `convex/lib/handoffs.ts`, existing `authz.ts`/`operation.ts`/schema and generated API bindings. No new grant kind or authorization bypass.
- Pure rules: `core/handoff.ts`, `core/handoff-read.ts`; existing pure snapshot projection remains in use.
- UI: behavior components for portfolio, snapshot browsing, source verification, preparation and errors; `src/components/shell/SourceViewer.tsx`; homepage, saved-handoff route and generated route tree. Optional source read failures are contained so the decision editor retains its draft.
- Tests: contract acceptance/rejection, two-real-repository persistence and permissions, client body/source integrity checks; prior T09 and full repository suites remain passing.

## Adversarial review findings and limits

- **Fixed `7b126aa`**: contract 0.2.0 made categories valid; old formatter projection silently dropped them and an old rejection test no longer compiled. Preserve category exactly, including absent versus present, and reject category changes in brief constraints.
- **Fixed `1784e51`**: a 64K-character brief could not fit the 16 KiB operation response. Contract **0.3.0** makes preparation return a bounded summary and adds `readHandoff` summary/body modes. Body reads require pinned revision and byte range; at most 2048 raw UTF-8 bytes per response, including safe server-selected character boundaries. Full reads still enforce the cap. Contract/shared-surface review belongs to @heyoub and @adiesh2.
- **Prevented `1784e51`**: fabricated but indexed ref digests cannot enter frozen briefs. Preparation reads the actual cached source and compares identity/range/digest. Cache eviction or corruption blocks saved reads; source absence never becomes a reconstructed quotation.
- **Checked `1784e51`**: parent/snapshot authorization on every read and receipt replay; foreign/missing IDs use the same error; stale preparation, public audiences and reader mutations leave no handoff/receipt. Replaying after newer decisions returns the original immutable brief. No response body in receipts.
- **Prevented `1784e51`**: discontinuous/swapped/tampered body windows cannot export; final exact UTF-8 hash must match. BOM/CRLF/Unicode preservation is tested. The hash remains beside the body, not circularly inside it.
- **Prevented `1af6a6f`**: a source-read failure no longer tears down the parent draft. Source HTML stays inert text. Directory pagination/back behavior and same-request uncertain-save retry were reviewed. Browser acceptance remains distinct from these code checks.

Bounds: maximum 256 decisions in a preparation; current contract caps of 32 non-acceptance constraints and 32 consumed evidence records; 65,536-character body; each evidence ref window at most 16 KiB. Over-limit/ambiguous input fails instead of omitting data. Each prepare creates a separate immutable ID at revision 1. No mutable handoff editing or list/search operation is introduced; bookmark its URL. Source ingestion remains the operator's authenticated internal path from T05. No remote provider or target-repository execution is introduced.

## Commands and actual results

Working directory: `/private/tmp/think-wide-t09`. Bun commands use `env PATH=/Users/marcandy/.bun/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`; installed Bun 1.4.2, Convex 1.46.0.

- `git fetch upstream`, `git fetch origin`, PR-state reads: exit 0. `git merge --no-ff upstream/main -m 'T09: merge T05 sources, contract 0.2.0, and T08 transport'`: exit 0.
- First post-merge `bun run verify`: exit 2, stale category rejection test failed TypeScript. Compatibility fix passed 44 T09 tests, then the gate passed 499 tests / 25 skipped before the persistence/source extension.
- `bun run codegen`: first rejected an incomplete strictRequired conditional; schema declarations corrected without weakening Ajv. Subsequent run exit 0, 20 schemas / 34 validators / 16 operations / 15 MCP tools. `bun scripts/operations-doc.ts --write`: exit 0, 13 implemented operations.
- `bunx convex codegen --dry-run --typecheck disable`: exit 1, worktree has no `CONVEX_DEPLOYMENT`. Generated API locally using the installed `apiCodegen(modulePaths)` template and installed Prettier, as T05 did; no manual API interface or deployment.
- `bun run build`: exit 0, generated the new handoff route plus client/SSR/Nitro builds.
- `bun run typecheck`: exit 0 after resolving bounded tuple construction and a test inference annotation.
- `bun run test -- tests/domain/t09-persistence.test.ts tests/domain/contract-handoff.test.ts tests/domain/t09-source-evidence.test.ts`: exit 0, **9 passed**. Initial fixture setup mistakenly used `src/beta.ts` instead of the fixture's `lib/beta.ts`; corrected. Large-body fixture was increased after asserting its actual bytes were only 13,279, not over the response cap. No assertion was removed.
- `bunx biome check --write` on changed source/core/contracts/tests: exit 0. New Convex files were also formatted with the installed Biome via a temporary config enabling braces; no repository rule changes.
- Final **`bun run verify`: exit 0**, frozen install, no drift (five generated files, twice; operation docs current), Biome 132 files, TypeScript, **511 tests passed / 25 skipped / 34 test files passed**, client/SSR/Nitro builds. All **51 T09 tests** passed. Log: `/private/tmp/t09-integrated-verify.log`.
- `git diff --check` and staged checks: exit 0. Existing missing pre-commit config causes the optional hook to skip; the explicit verify gate passed.

**Status level:** local real handlers over two synthetic Git repositories, plus pure/SSR fixtures. The 25 upstream analyzer/confinement skips lack an isolation profile and are **NOT RUN**. Browser identity/reload/download acceptance, live provider/host source/handoff flow and deployment are **NOT RUN**, not implied by compilation, old T08 host evidence or these local tests.
