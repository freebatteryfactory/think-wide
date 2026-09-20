# T11 preparation and capture handoff

Status: **PARTIAL / prerequisites and saved-brief integration**. Current integrated
base: `1424f5d` (T09 merge), contract **0.3.0**. [T11 draft PR #27](https://github.com/freebatteryfactory/think-wide-hackathon/pull/27).
Marc requested this continuation after T09 merged; the original 15:00 recording
checkpoint was not met by this work. The seed names Andrew as T11 lead and Marc as
capture partner. T10a is now issued as #28 to Eassa; its PR #31 is still open at this
checkpoint. No issued T11 issue was found. Confirm writing/capture roles with Andrew.

This branch is `feat/t11-integration-prep` in `/private/tmp/think-wide-t11`; only new
integration tests and evidence are authored here. T09 was merged into this branch.
The user's root checkout is now another session's `t10-reasoning` branch; it was not
switched or edited. The local main reference was advanced to `1424f5d`.

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
| Analyzer isolation | Andrew | Supply Q13/structural results for the recording host. This sandbox skips 25 existing cases; no structural acceptance claimed. |
| Live source ingestion | Eassa T08 #21 / draft PR #29 | Concrete blocker: internal snapshots:register with CLI --identity reports function not found, while the same internal call without identity correctly rejects unauthenticated. Backend portfolio remains empty per PR #29/#31 evidence. Need a supported, reviewed operator ingestion path preserving verified identity; no auth bypass. |
| Persistent workbench/brief | T09 #20 | **MERGED** at 1424f5d. Source UI and protected prepare/readHandoff, ranged export and acceptance ledger are present. New T11 MCP/handler integration passes; authenticated browser behavior still needs I01. |
| Live reasoning/correction | Eassa, T10a #28 / PR #31; T10 driver session | PR #31 adds explicit host admission/proposal submission but remains unmerged. It was based on contract 0.2.1; main is now 0.3.0, so owner must reconcile generated contract/operation maps and retest after merge. Then demonstrate actual host/model reasoning and changed comparison after correction. Backend admission or deterministic test claims do not satisfy this. |
| Browser identity | Andrew I01 #17 | Browser provider still lacks verified login. Local stdio identity is a separate mode, not browser auth. Agree the permitted capture surface before rehearsal. |
| Full recording acceptance | Andrew + Marc | Same tested commit/config for source ingestion, driver, decisions and brief; actual driver events; first original recording location/hash; final brief ID/revision/hash; explicit missing capabilities. |

T09 has removed the brief-persistence blocker. T10 merging alone will not unblock Q15:
a live source portfolio and real reasoning round trip are still required. A local MCP
recording does not establish remote MCP, hosted identity or deployment. Optional VPS
work (I04 PR #30) is separate and does not block an approved local recording.

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
