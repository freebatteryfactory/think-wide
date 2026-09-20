# T09 preparatory implementation and blockers

Current state: [integrated T09 review](T09_INTEGRATED_REVIEW.md) supersedes the historical blockers below. T05/main are integrated; protected handoff persistence and source UI are implemented.
Date: 2026-09-20. Ticket status: **PARTIAL / BLOCKED for completion**, ready for review of this slice. Reviewer: Andrew. Nothing here establishes acceptance or integration into trunk.

Branch: `feat/t09-persistent-workbench` in `/private/tmp/think-wide-t09`.
Initial base: merged T06 at `41e73adfa1ba3011a457eb996a0c450a4afc9dfb` (PR #12).
Initial verified code commit: `6a5fef06245df81d7d07b57eeafcb39cd60be61c`.
Latest integrated upstream: `2c14b9988fcf7b812eac71cbf0595600c82f973a`, including T03 merge `73459b0`, T07, pinned ast-grep, and the main lint fix.
Contract: **0.1.0**. Draft PR: [#20](https://github.com/freebatteryfactory/think-wide-hackathon/pull/20).

Current continuation: [T09 adversarial review and focused commits](T09_ADVERSARIAL_REVIEW.md). Verified code is now `48faaf301e006a9e5b750236b52426672d11ae70`: T03 UI/navigation integration, pure snapshot projection, and disconnected export preparation are implemented. The new full gate passes **320 tests, 25 skipped**. Sections below retain the initial slice/sync evidence; the continuation supersedes their pending-work status where explicitly stated. T05 is now open as [PR #23](https://github.com/freebatteryfactory/think-wide-hackathon/pull/23), still unmerged at the final check.

## Upstream sync after T03 merged

**DONE:** T03's merged theme, catalog, workshop, fonts, tests and root/homepage are now in this T09 branch. `/workshop` and `/investigations/$investigationId` both appear in the regenerated route tree. T03 is no longer an external merge blocker; adapting its preview editor to the persistent command behavior remains T09 implementation work.

`git fetch upstream` succeeded. The first merge attempt hit the local fast-forward-only setting; `git merge --no-ff --no-commit upstream/main` then produced one conflict, solely in `src/routeTree.gen.ts`. Restored its T09 version temporarily and ran `bun install --frozen-lockfile` and `bun run build` (both exit 0) to regenerate from both route files. No generated output was hand-edited. Upstream removed the Router CLI and `generate-routes` script; use the Start/Vite build from here.

The imported Biome rule requires block statements in `src/`. `bunx biome check --write src/components/behavior 'src/routes/investigations.$investigationId.tsx'` reported nine violations. Applied and reviewed the brace-only fixes with `bunx biome check --write --unsafe src/components/behavior/InvestigationWorkbench.tsx src/components/behavior/workbench.ts` (exit 0). No rule was disabled.

`bun run verify` after regeneration and the brace fixes: **exit 0**, no contract drift, Biome/TypeScript/builds pass; **300 tests passed, 25 skipped, 19 test files passed**. The skips are upstream's conditional analyzer/isolation cases (20 Q13 and 5 structural-search cases); this host lacks the required isolation profile. They are **NOT RUN**, not passes. All 20 T09 tests passed. `git diff --check`: exit 0. No additional browser or live-provider acceptance was run for this sync; status remains **local real handlers**. The separate T05 checkout and its uncommitted changes remain untouched.

After staging the merge, `git diff --cached --check` reports exit 2 for an existing `||||||| merged common ancestors` line at `docs/evidence/T03_LOCAL_REVIEW.md:150`. Confirmed the same line in `upstream/main`; it is not an unresolved index conflict or generated-route issue. Preserved that upstream evidence file rather than editing T03's report. The check above was the unstaged-diff check; the staged check must not be represented as passing. `git diff --name-only --diff-filter=U` is empty after route regeneration/staging.

Marc explicitly requested starting the available T09 work while T03 awaits merge and another writer owns T05. No issued T09 GitHub issue was found. This slice uses `docs/tickets/T09.md`, the exact paths in `docs/REPO_MAP.md`, and accepted decisions 0001–0003. The seed's 14:15 EDT cutoff had already passed; this is the newly requested preparatory slice, not a claim that the original deadline was met. No subagents were dispatched.

## Changes and actual behavior

- `core/handoff.ts`: deterministic private Markdown brief formatter, exact UTF-8 SHA-256, complete revision/decision-ledger checks, corrections and rejections preserved, literal fenced user/source text, structured refs, base commit, scope, uncertainties and acceptance. Refuses wider audiences, publication claims, unproven test success, malformed exact refs, omitted constraints and oversized output. It does **not** authorize, persist or publish a handoff. Its caller must supply already authorized inputs and metadata from trusted storage.
- `src/components/behavior/workbench.ts`: generated-contract command validation, exact statement preservation, sanitized public errors and bounded-page assembly checks.
- `src/components/behavior/InvestigationWorkbench.tsx`: calls the existing protected `readInvestigation` and `recordDecision` handlers through `convex/_generated/api`; live revision, all four decision actions, paged history, explicit review of a newer revision, and reuse of the same request/key when the save outcome is uncertain. Drafts remain in component state on mutation failures. No browser persistence store or fabricated identity. A disconnected service hides the workbench and shows connection status.
- `src/routes/investigations.$investigationId.tsx`: direct investigation route with a sanitized error boundary. Visit `/investigations/<existing-authorized-id>` after the connection is configured. Homepage/catalog integration is still pending.
- `src/routeTree.gen.ts`: generated by the installed Router CLI and Start/Vite build, not edited by hand.
- `tests/domain/t09-{handoff,workbench}.test.ts`: 20 tests; workbench commands use real T06 handlers under `convex-test` identities and current grants. Formatter tests use explicitly synthetic metadata, not T05 source verification.

The active checkout remains on the other writer's T05 branch. The initial T09 slice did not edit T03 catalog/theme/root/homepage files, T05 files, `convex/`, contracts, generated contract files, manifests or lockfile. The sync imports upstream's committed changes to those shared artifacts; it adds no independent manifest or contract changes.

## Dependencies and concrete next actions

| Dependency | Evidence / blocker | Next action |
| --- | --- | --- |
| T06 | **AVAILABLE**: merged PR #12 provides real protected investigation/decision handlers. | Existing operations are consumed directly. Do not add a second operation path. |
| T03 / [PR #13](https://github.com/freebatteryfactory/think-wide-hackathon/pull/13) | **AVAILABLE AND INTEGRATED** from upstream. `ConstraintEditor` still describes a workshop preview; it is not a persistent-submit component. | Adapt the reviewed editor to this command behavior, wire navigation, and check both themes and narrow layouts. Both routes are already regenerated. Native React controls remain the temporary stable UI, now using the merged semantic tokens. |
| T05 / [issue #11](https://github.com/freebatteryfactory/think-wide-hackathon/issues/11) | Another writer is actively changing snapshot registration/accessors/schema. Main has no usable repository/snapshot projection for target selection. Stored refs currently mean authorized membership, not verified existence. | Consume the integrated snapshot mapping, exact source viewer and authoritative repository/base commit. Do not infer a target commit from a branch name or user text. |
| Shared T06 infrastructure for T09 | `operation.ts` request/response/read/state unions, replay reread and `authz.ts` capability methods do not support handoffs. Schema has no handoffs table or handoff receipt result kind. These shared files overlap T05's current work and are outside the independently owned slice. | Coordinate with Eassa/T05; extend the existing wrapper, authorized accessor and storage atomically, then add `convex/handoffs.ts`. A standalone public handoff function would bypass policy and is not an acceptable shortcut. |
| Handoff projection | `PrepareHandoffRequest` supplies investigation/revision/target/audience, not editable acceptance/scope fields. The formatter accepts generated `Handoff` fields but no trusted storage projection exists yet. | Define the deterministic projection from the complete authorized investigation ledger and target snapshot; check `expectedRevision`, resolve exact base commit, freeze body/hash and receipt in the same transaction. Explicitly handle missing scope/acceptance without inventing success. |
| Ranged reads / [issue #10](https://github.com/freebatteryfactory/think-wide-hackathon/issues/10) | T09 owns the contract change, coordinated with Eassa. Current `readHandoff` has no range and returns the full `Handoff`; the wrapper caps serialized UTF-8 responses at 16 KiB. | Agree on exact range/cursor/response semantics, regenerate contract 0.2.0 with its owner, test reassembly and whole-body hash. Until then the formatter rejects the **whole response** above 16 KiB; it never truncates. |
| I01 / local verified identity | The app currently uses bare `ConvexProvider`, with no JWT/login integration. `useConvexAuth` requires an auth provider that is absent; this slice does not pretend that hook supplies authentication. Local Convex at `127.0.0.1:3210` was unreachable during smoke testing. | Configure/deploy the real local handlers and a verified browser identity with the responsible owner. Ensure principal switches clear/remount user-scoped UI state, then prove save → reload in the browser. No fixture principal, skipped audience check, or admin key in web code. |
| Categories / [issue #14](https://github.com/freebatteryfactory/think-wide-hackathon/issues/14) | Accepted decision 0003 supersedes the earlier proposal, but 0.1.0 validators still reject `category`. | After 0.2.0/backend/category UI integration, propagate the generated optional field into handoff constraints. The current formatter rejects unsupported fields, preventing silent loss. Optional; does not block the initial category-free loop. |
| I03 issue publication | No approved publisher/audience integration exists. | Keep the action disabled. Private brief persistence/export does not require Issues write access. Wider audiences require checks on **all** consumed inputs, including private decisions. |

## Requirement status

| T09 requirement | Status and evidence |
| --- | --- |
| Correction and prior rejection survive reread | **DONE at local real-handler level**: new reader sees unchanged saved statements and revisions; same-key replay creates no duplicate. |
| Correction and rejection survive browser reload | **PARTIAL**: route is wired; authenticated browser round trip **NOT RUN**, blocked by service/identity integration. |
| Save without an LLM | **DONE**: directly uses `recordDecision`; no model/provider call is introduced. |
| Deterministic brief with base, constraints, refs, uncertainty, acceptance, scope and hash | **PARTIAL**: formatter/tests done; trusted snapshot projection, transaction, saved reads and actual download/copy flow **NOT DONE**. |
| Exact ranged `readHandoff` | **NOT DONE**: shared contract coordination required; over-cap refusal implemented in formatter. |
| Unsupported issue publication visibly disabled | **DONE in component code** and formatter rejects issue audiences. Authenticated rendered control verification **NOT RUN**. |
| Reviewed theme/catalog integration and two-repo full loop | **NOT DONE**: T03/T05/I01 integration and T10/T11 remain. |

## Commands and real results

In `/private/tmp/think-wide-t09`, successful Bun commands used:

```sh
env PATH=/Users/marcandy/.bun/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin bun <arguments>
```

- Initial plain `bun install --frozen-lockfile`: exit 127 because Bun was absent from the temporary worktree shell's PATH. `/Users/marcandy/.bun/bin/bun install --frozen-lockfile`: exit 0, lockfile unchanged. Runtime was Bun 1.4.2; manifest declares 1.4.0. Installed Convex 1.46.0 and convex-test 0.0.59 came from the frozen lockfile.
- `bun run generate-routes`: exit 0. The later Start/Vite build restores its generated Start registration footer.
- `bunx biome check --write core/handoff.ts src/components/behavior 'src/routes/investigations.$investigationId.tsx' tests/domain/t09-handoff.test.ts tests/domain/t09-workbench.test.ts`: first pass reported three semantic-element issues; changed status paragraphs to `output`, subsequent pass exit 0.
- `bun run typecheck`: first pass found one `unknown` error after the generated validator. Fixed with a cast **after successful generated runtime validation**, matching the backend boundary pattern; the full gate then passed TypeScript. No `any`, double casts, disabled validators or skipped tests added to handwritten code.
- `bun run test -- tests/domain/t09-handoff.test.ts tests/domain/t09-workbench.test.ts`: exit 0, **20/20**.
- `bun run verify`: exit 0, **189/189 across 12 files**; frozen install, no contract drift, Biome, TypeScript, Vitest, client/SSR/Nitro production builds. Repeated after the connection-state/error-copy adjustments, also exit 0. Existing Biome schema-version informational warning and bundler `use client` warnings remain; not silenced.
- `git -c core.fsmonitor=false diff --check`: exit 0.
- `VITE_CONVEX_URL=http://127.0.0.1:3210 bun run dev --host 127.0.0.1 --port 3019`: required a sandbox escalation for a reachable loopback server. Chrome at `/investigations/t09-smoke` showed the route and then the verified disconnected-service message after reload. No protected data or authenticated form was exercised.
- `curl --silent --show-error --max-time 3 http://127.0.0.1:3210/version`: exit 7, no service reachable from the sandbox. No deployment or service reconfiguration attempted.

**Status level:** workbench command tests = **local real handlers**; brief formatter = **fixtures only**; browser = route/disconnection smoke only. Authenticated reload, real source-backed persisted brief, live provider/host, deployed behavior = **NOT RUN**.

## Assumptions and limits

- Used merged T06/main as the initial stable base because no issued T09 base exists; subsequently integrated merged T03/T07 from upstream. No unmerged T05 work was taken into this branch.
- A complete human ledger is required by the formatter. More than 32 non-acceptance decisions cannot fit the current structured handoff contract; reject rather than omit old rejections. Human acceptance appears in the ledger and never becomes a claim that tests ran.
- `bodyHash` is beside the exact Markdown body, not embedded in the bytes it hashes (which would create a circular hash). The future download/copy UI must show that hash alongside the frozen body.
- Unsaved drafts do not survive navigation/reload. There is no durable handoff until the coordinated mutation lands. UI session/account-change acceptance remains pending with I01.
- Full T09 completion must remain blocked until the dependencies above are integrated and the relevant end-to-end checks actually run.
