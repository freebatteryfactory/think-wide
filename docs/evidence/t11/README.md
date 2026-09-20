# T11 preparation and capture handoff

Status: **PARTIAL / public host-proposal and saved-brief integration**. Current integrated
base: `c14ced5` (T08 #29, T11 #32 and T10 #37 also merged), contract **0.4.0**. [T11 draft PR #27](https://github.com/freebatteryfactory/think-wide-hackathon/pull/27).
Marc requested this continuation after T09 merged; the original 15:00 recording
checkpoint was not met by this work. The seed names Andrew as T11 lead and Marc as
capture partner. T10 PRs #31/#37 and Andrew's T11 PR #32 are merged; their tests are included here. No issued T11 issue was found. Confirm writing/capture roles with Andrew.

This branch is `feat/t11-integration-prep` in `/private/tmp/think-wide-t11`; only new
integration tests and evidence are authored here. T09 and T10 were merged into this branch.
The user's root checkout is already `main` at `c14ced5`. Its untracked files, including
another session's `tests/adapter/t10-live.ts`, were preserved; that script was not run.

## Completion decision at c14ced5

Use **local stdio MCP + synthetic alpha/beta + an actual external model host** for
T11's first complete recording. The merged implementation supports that path;
waiting for WorkOS or deployment is unnecessary for this explicitly local result.
Authenticated browser acceptance remains a separate open requirement if the chosen
recording surface is changed to the browser. A workshop pass is not backend acceptance.

Remaining steps, in order:

1. **Review the evidence-integrity concern with Eassa/Andrew.** Andrew's merged
   `docs/evidence/T11.md` records that public submitProposal accepts an indexed ref
   with a fabricated digest. Code inspection confirms indexed-ref authorization
   does not hash its bytes; findings remain unverified. Handoff preparation/read
   re-reads and compares exact bytes. The existing T09 persistence test rejects a
   fabricated *decision* ref at brief creation, but is not the proposal-path test.
   Before final sign-off, add the public proposal → rejected brief negative case
   and have the owners resolve or explicitly accept/document the submission-time
   limitation. Do not claim model-provided digests were verified on submission.
2. **Choose the capture machine and prepare one identified build.** Andrew drives
   or independently verifies; Marc captures. Use the merged operator setup, then
   inspect capabilities and listProjects through the actual host. Require both
   alpha/beta snapshots and record contract 0.4.0 plus their full commits. Old
   empty-portfolio reports are historical. Never run the untracked live script
   owned by another session without coordinating its use.
3. **Run and record the actual Q15 loop.** Model reads bounded evidence from both
   repositories, publishes its tentative hypothesis, then consumes Marc's selected
   correction: “Keep alpha and beta independent; similar code is not permission
   to introduce a shared dependency.” Admit a fresh run, observe the model's changed
   conclusion, reopen the investigation, and verify/export the revised brief.
   Preserve the first brief too: old findings remain historical/unverified, not
   deleted. A scripted SDK proposal is insufficient for this requirement.
4. **Finish the receipt and acceptance.** Record commit/config, host/model versions,
   run/decision/brief IDs, source and body hashes, exact capabilities and limitations.
   Preserve and hash the first unmodified original recording, fill the shared
   manifest, and have Andrew/Marc inspect the evidence. Run combined regressions
   on that build; retain the separate recording-host isolation receipt.
5. **Review and merge PR #27.** Its MCP/exact-byte tests and manifest complement
   the already merged PR #32. T11 is DONE only after the recording/acceptance and
   remaining T11 work are integrated; green local tests alone are PARTIAL.

Search/readGuidance remain unbound: capture must say **browse + exact reads**.
Hosted identity, remote MCP, deployment, issue publication and outcome ingestion
are not established by the local recording. No new provider library or production
feature is required to attempt it. Historical sections below keep their original
commands/results and must not be read as current dependency status.

## What exists now

`tests/integration/t11-source-decision.test.ts` imports the real alpha/beta bundles,
registers them through real internal Convex handlers under fixture identities, and
populates exact-byte caches through the real integrity-checked writer. It then tests:

- Q04/Q07: independent expected bytes/digests, both repository identities, Unicode
  and CRLF, one durable correction across replay/conflict, and a fresh client reading
  the same decision and consuming its persisted source refs.
- Q01: B's permitted source succeeds before foreign/missing source/investigation
  requests and foreign nested refs are denied; investigations, decisions, receipts,
  runs and scheduled jobs remain unchanged.
- Q06: a deterministic admitted run at revision 0 cannot publish after the human
  correction advances revision 1. Reopening retains the correction and exact refs.

This is **local real handlers over synthetic source**. Fixture identities do not
verify JWT/login. A new client over the same test database is not a browser reload or
server restart. The late proposal is authored test data, not live model output.
No provider dispatch observation or recorded Q15 completion is claimed. There is no
fake passing or skipped `q15-full-loop.test.ts` standing in for the missing full flow.

Run the focused prerequisite check:

```sh
bun run test -- tests/integration/t11-source-decision.test.ts
```

If Bun is missing from PATH in a temporary worktree, use the installed
`/Users/marcandy/.bun/bin/bun`, or add that directory to PATH for this shell.

## Dependencies and coordination

| Need | Owner / coordinate with | Current state / precise handoff needed |
| --- | --- | --- |
| Regression/capture ownership | Andrew + Marc | This session owns the prerequisite tests and capture kit. Andrew reviews negative cases, observes effects, and independently accepts the recording. Confirm who drives and who records. |
| Search and coverage | Andrew, T07 #7 | Libraries exist; searchSources and readGuidance remain unbound in main. Supply merged handler SHA and real source-ref round trip, or explicitly agree a bounded browse/exact-read demonstration. Do not advertise search as connected. |
| Analyzer isolation | Andrew | Andrew reports all 25 Q13 tests passed with bwrap on his machine in PR #32. This sandbox still skips them; retain his receipt separately and rerun on the final recording commit. |
| Live source ingestion | Eassa T08 #21 / merged PR #29 | **CODE BLOCKER RESOLVED.** Reviewed internal operator provisioning and local:setup are merged. T08 reports a seeded live SDK/Claude host pass on its backend. Run setup/preflight on the selected capture machine; do not infer its portfolio from another host or the old T10 empty-portfolio receipt. |
| Persistent workbench/brief | T09 #20 | **MERGED** at 1424f5d. Source UI and protected prepare/readHandoff, ranged export and acceptance ledger are present. New T11 MCP/handler integration passes; authenticated browser behavior still needs I01. |
| Live reasoning/correction | T10 driver session + Andrew/Marc | **PR #37 MERGED** at c14ced5. Scripted comparison/correction/revised and frozen briefs pass. Its live Claude acceptance is preflight only; the actual model must still propose, consume the human correction, revise, reopen and export during one recorded run. |
| Browser identity | Andrew I01 #17 | Draft PR #33 has WorkOS login wiring and issuer configuration; its receipt says Convex token acceptance and passing the user token into dispatch remain NOT RUN/incomplete. Local stdio identity is a separate mode. Agree the permitted capture surface before rehearsal. |
| Full recording acceptance | Andrew + Marc | Same tested commit/config for source ingestion, driver, decisions and brief; actual driver events; first original recording location/hash; final brief ID/revision/hash; explicit missing capabilities. |

T08, T09 and T10 now provide the implementation path for a local stdio Q15 attempt.
The remaining gate is observed acceptance on the selected capture backend: verify its
source portfolio, run real reasoning and preserve the recording. A local MCP
recording does not establish remote MCP, hosted identity or deployment. VPS infrastructure
work (I04 PR #30, now merged) is separate and does not establish deployed T11 acceptance.

## Capture script for the integrated local path

Use only the owned synthetic alpha/beta sources. Keep the original recording outside
the public repository. Do not put private sources, tokens, cookies, signing keys,
raw traces or sensitive URL parameters in the video or published receipt.

1. Record the clean combined commit, contract version, app/backend configuration
   identifiers (no credentials), actual host/model versions and each pinned source
   commit/tree ID. Run `bun run verify` and record skips honestly.
2. Start capture before the first interaction. Show the actual supported mode and
   limitations. Keep the terminal/dashboard containing credentials off-screen.
3. Select both repositories. Ask: **“Compare alphaMarker and betaMarker. What code
   could be shared, and what behavior must remain repository-specific?”**
4. Have the live driver retrieve bounded evidence from both sources. Open the exact
   returned refs; preserve commit/blob/entry/range/digest and coverage in the receipt.
5. Show the tentative comparison with source refs. Record the actual reasoning driver
   and tool events; do not substitute the deterministic regression claim.
6. Submit the human correction: **“Keep the alpha and beta marker implementations
   separate. Shared function shape does not prove shared behavior. Preserve each
   repository's marker value.”** Save its decision ID and new revision.
7. Run the same real driver again. Show how the accepted comparison changes while
   preserving the human decision. Exercise stale publication/replay in the approved
   QA lane; do not dispatch an extra model solely to fabricate a race.
8. Reload/reopen the investigation from the chosen surface. Confirm the decision,
   accepted result, exact refs and revision survive. State whether this was a browser
   reload, new host session or just a query; these are different observations.
9. Prepare and read the saved implementation brief. Verify its recorded body hash,
   target snapshot and decision revision; export only through the permitted UI/path.
10. Stop capture and preserve the **first successful original** unchanged, even if
    another take is prettier. Hash it with `shasum -a 256 <recording-path>`, record
    the exact artifact location in a private run receipt, and make edits only on a
    separate copy. A failed attempt stays labeled partial.

No target-repository code/build/test/install/repair runs during this flow. Issue
publishing, outcome ingestion, remote host and deployment remain explicitly missing
unless independently exercised and recorded; they are not prerequisites to a local
Q15 recording when the chosen fallback is approved.

## Evidence manifest

Copy `recording-manifest.template.json` into a private run directory. Replace nulls
only with observed values. `status` stays `not_run`/`partial` until every required
Q15 step is observed on the identified build. Review the filled receipt with Andrew
before publishing a sanitized copy. Keep original video and raw host traces private.

Final acceptance must include Q01, Q04, Q06, Q07 and Q15 with their layers separated.
The prerequisite tests above supplement Andrew's existing suites; they do not replace
his complete negative matrix or a real driver/browser/host recording.

## Initial preparation verification and review (b22658a)

- `/Users/marcandy/.bun/bin/bun install --frozen-lockfile`: exit 0; no manifest/lock edits.
- `bun run test -- tests/integration/t11-source-decision.test.ts`: **3 passed**.
- `bun run verify` (installed Bun directory added to PATH in this temporary worktree):
  **exit 0**, **458 passed / 25 skipped across 27 files**, drift/lint/types/build pass.
  Log: `/tmp/think-wide-t11-verify.log`. Existing skipped Q13/structural cases require
  an isolation profile unavailable in this sandbox. Existing lint advisories and
  dependency bundler warnings remain; no rule or test was disabled.
- JSON template parses with `python3 -m json.tool`; `git diff --check` is clean.

Adversarial self-review: checked independent expected source bytes, no authorization
mock, permitted controls before denials, full persisted ref comparison (not just the
text), unchanged business rows/jobs on denied mutations, a successful current-revision
publication control alongside stale rejection, cleanup, and honest evidence layers.
No recording, live-model invocation, browser acceptance, deployment, or local
CodeRabbit run was performed. Online PR review is separate from these results.

## After T09: additional observed results

`tests/integration/t11-mcp-handoff.test.ts` adds two integration cases using the actual
MCP SDK in-memory transport, generated dispatch and Convex handlers. Only the HTTP
client transport is substituted into convex-test fixture identities. It is **local
real handlers**, not a network/stdio host or JWT verification.

- A browses both real Git snapshots and reads exact source refs through MCP. The
  independent fixture bytes/digests and full ref identities match.
- Correction and Unicode/CRLF acceptance decisions survive replay and a new MCP
  client. The decision ledger is paginated; the test follows its actual cursor.
- Saved briefs over 16 KiB reassemble through the production export reader over
  multiple MCP body windows. The resulting byte length and SHA-256 match the saved
  summary, including both source commits, correction and full acceptance statement.
- A later decision cannot rewrite a saved brief. Replay returns that same brief;
  changed payload/stale new preparation fail without handoff/receipt/job changes.
- B can export B's own brief; foreign and missing briefs have identical denial.
- Revoking A's consumed beta snapshot after its first body window prevents the next
  window, export completion, summary and receipt replay. A's alpha and B's beta reads
  still succeed. Business state/jobs remain unchanged by denials. Already delivered
  bytes are not claimed to be recalled.

Commands on this integrated worktree:

- `bun run typecheck`: exit 0.
- `bun run test -- tests/integration/t11-mcp-handoff.test.ts tests/integration/t11-source-decision.test.ts`:
  **5 passed**. Initial test assumed the entire large decision ledger fit one page;
  it now follows the real cursor and asserts both decisions, rather than weakening
  the expectation. Generated envelope entries are validated before typed access.
- `bun run verify`: **exit 0, 517 passed / 25 skipped / 36 files**, drift/lint/types/build
  pass. Log: `/tmp/think-wide-t11-after-t09-verify.log`. Existing isolation skips and
  dependency build/lint advisories remain. No dependency, contract, auth or production
  handler change was made by this continuation.
- Adversarial self-review checked that the transport substitute does not mock policy,
  refs come from MCP tree/read results, exact byte oracles are independent, the whole
  ledger is consumed, export verifies the final hash, positive controls accompany
  denials, mid-export revocation rechecks the consumed source, and denied work leaves
  receipts/handoffs/jobs unchanged. Local CodeRabbit remains skipped by Marc's instruction.

Browser smoke: actual Chrome at `http://127.0.0.1:3011`, isolated worktree dev server
with no VITE_CONVEX_URL. Homepage rendered its explicit backend-unavailable message;
entering the synthetic ID `t11-smoke-missing` navigated to the investigation fallback;
the saved-brief route rendered the same fallback and heading; the workshop link opened
its rendered catalog. **PASS only for no-backend startup/navigation**. No source
portfolio, authenticated save/reload, clipboard/download, live model or complete
recording was exercised. The initial sandbox listener failed; normal Node/Vite dev
startup with loopback permission succeeded. No backend deployment/configuration or
fixture ingestion was performed. The temporary smoke servers were stopped after checking; no deployed app was created.


## After T10: public proposal flow and complementary review

At base `76c193b`, contract 0.4.0, the third MCP integration case exercises:

1. Open a two-repository investigation and admit a host run through generated MCP tools.
2. Browse/read both real bundle sources and check independent exact-byte identities.
3. Save/replay a correction. The decision itself supersedes the pending run.
4. Submit its late proposal through public submitProposal: revision_conflict; no
   investigation, decision, receipt, run, handoff or job changes from rejection.
5. Admit a revision-1 host run, publish an authored revised proposal, verify its
   unverified hypothesis and exact refs, replay it, and reject changed-key payload reuse.
6. Reopen through a new MCP client: correction and revised finding remain, rejected
   finding is absent. Prepare/read/export the brief and verify byte length, SHA-256,
   correction, revised finding and both source commit/digest identities.

This is **local real handlers with substituted transport and fixture identities**.
The proposals are authored test data. No real host/model, network transport, browser
login, backend deployment or recording was exercised in this continuation.

Initial validation caught two test-authoring assumptions: generated bounded arrays
require tuple types, and recordDecision already persists superseded for the current
run before a late submission. The test now uses generated source-ref types and checks
that status both before and after the rejection; the unchanged-state assertion stays.

### Andrew's PR #32 review

Read-only code/evidence review at `ae473c1b8e5a08069ee0ad66920df9b3fd36dbf5`:

- His internal publication tests complement this branch's public MCP tests. They
  cover late publication, revoked snapshot fences, four denied owner operations,
  unchanged business rows/jobs, and a permitted B control after revocation.
- No concrete authorization defect found in that inspected test change. It uses
  real handlers, but its refs are synthetic metadata and it calls internal publish;
  neither real source bytes nor public proposal submission is established by it.
- Follow-ups before calling the combined evidence final: replace obsolete comments
  and blocker rows about unbound handoff/submitProposal operations; replace the
  substring-only reopened-ref check with full source-ref equality. Our tests already
  check full refs separately; we did not edit Andrew's branch or duplicate his file.
- His 25/25 bwrap isolation pass is **reported by Andrew**, not rerun on this Mac.
  Keep the disclosed earlier unidentified/non-reproducing failure visible, and rerun
  the combined commit on the capture host before recording. No flake diagnosis claimed.
- PR #27's manifest stays the shared template. PR #32 remains separately reviewable;
  it was not merged into this branch. No teammate messages or review comments sent.

Remaining live blockers: PR #29 ingestion; real host/model execution; PR #33 backend
identity acceptance for a browser capture; agreed search/browse scope. The original
recording and authenticated browser acceptance remain **NOT RUN**.

Verification for the T10 continuation:

- `bun x biome check --write tests/integration/t11-mcp-handoff.test.ts`: clean after formatting.
- `bun run test -- tests/integration/t11-mcp-handoff.test.ts tests/integration/t11-source-decision.test.ts`:
  **6 passed** after correcting the test-authoring assumptions above.
- `bun run verify`: **exit 0; 545 passed / 25 skipped / 38 files**; frozen install,
  generated drift, Biome, TypeScript and production build pass. Log:
  `/tmp/think-wide-t11-after-t10-verify.log`. Existing warnings and isolation skips
  remain; no suppression or dependency changes.
- `git diff --check`: clean. Adversarial self-review completed: independent source
  oracle, real policy/transaction path, generated request types, stale negative plus
  fresh positive publication, unchanged rows/receipts/jobs on rejection and replay,
  preserved correction and exact finding refs after reopen, export hash/length and
  rejected-claim absence. No production changes or local CodeRabbit run.

## Combined checkpoint after PRs #29, #32 and #37

Main `c14ced5`, contract 0.4.0. Updated root main and isolated T11; preserved all
untracked session files. A concurrent remote merge had the same committed tree
and was integrated without overwriting it. No source code authored in this sync.

- `bun run verify`: **exit 0, 568 passed / 25 existing isolation skips / 42 files**;
  frozen dependencies, drift, lint, types and production build pass. Log:
  `/tmp/think-wide-t11-current-verify.log`.
- `env -u VITE_CONVEX_URL bun run test:browser`: **exit 0, 7 passed / 1 file** after
  retrying with loopback/browser permission. The first sandbox run failed startup
  with listen EPERM and watcher EMFILE; it was not a browser acceptance pass. Retry
  log: `/tmp/think-wide-t11-current-browser-retry.log`.
- These browser checks exercise the synthetic workshop only, not authenticated
  backend workbench persistence or Q15. No live model/setup/deployment or recording
  was run in this sync. T08's seeded host receipt belongs to its original environment.
- Adversarial review: checked merged production/authorization changes and published
  evidence against current handlers; retained the open proposal-digest concern,
  exact handoff byte-check distinction and honest historical evidence layers.
  `git diff --check` clean. No local CodeRabbit run.

Status: **PARTIAL / ready to attempt local live acceptance**, subject to the
capture-machine preflight and explicit evidence-integrity review above.
