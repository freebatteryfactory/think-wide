# T11 preparation and capture handoff

Status: **PARTIAL / prerequisites only**. Base `ecd0be2` (T05 merge), contract
0.2.0. Marc requested this preparation on September 20 after T05 merged; another
session owns T09. The original 15:00 recording checkpoint was not met by this work.
The seed names Andrew as T11 lead and Marc as capture partner. No issued T11 or T10
GitHub ticket was found at preparation time; confirm the writing/capture split with
Andrew and Eassa before overlapping their files. This branch is `feat/t11-integration-prep`
in `/private/tmp/think-wide-t11` and touches only new integration tests and evidence.

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
| Regression/capture ownership | Andrew + Marc | Proposed split: this session owns this new prerequisite test and capture kit; Andrew reviews negative cases, observes effects, and independently accepts the recording. Confirm who drives and who records. |
| Search and coverage | Andrew, T07 #7 | Libraries exist; `searchSources` and `readGuidance` remain unbound in main. Supply merged handler SHA and real source-ref round trip, or explicitly agree a bounded exact-read/literal-only degraded demo. |
| Analyzer isolation | Andrew | Supply Q13/structural results for the actual recording host. This sandbox skips 25 existing cases. An unrun structural mode cannot be presented as working. |
| Identity and source setup | Andrew I01 #17 + Eassa T08 #21 | Supply verified browser-login path if recording UI; otherwise agree the existing approved local stdio path. Need actual authorized alpha/beta ingestion and source reads over the chosen surface. T08's older host receipt predates T05 and covers decisions only. |
| Persistent workbench/brief | Other T09 session, PR #20 / #25 | Merge source selection/exact reads and protected prepare/readHandoff. Supply route, setup commands, reopen behavior, receipt/replay semantics, and saved-brief export path. Categories exist in contract/backend; UI is separate. |
| Live reasoning/correction | T10 owner with Eassa + Andrew review | Confirm owner and issued task; supply chosen host/provider/model, actual proposal submission/publication path, changed accepted result after correction, and stale-proposal rejection. Internal deterministic publication alone does not satisfy this. |
| Full recording acceptance | Andrew + Marc | Combined tested SHA, mode, sanitized setup, recording operator/location, first original video/hash, actual driver events, final brief ID/revision/hash, and separate missing-capability list. |

T09 and T10 merging is necessary for the planned full UI flow, but not sufficient:
source ingestion, search availability and verified identity must work together on
the same build. Local MCP does not establish remote MCP or hosted identity.

## Capture script once dependencies land

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

## Preparation verification and review

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
