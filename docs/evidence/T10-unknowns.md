# T10: preserve claim unknowns (issue #51)

## Behavior

Contract 0.6.0 adds optional `Finding.unknowns`, using the same generated
`ClaimUnknowns` definition as proposal claims: up to eight nonempty questions of
at most 512 characters each. Old findings remain valid. Publication preserves
absent, empty and populated values without changing their verification status.
The investigation view displays unresolved questions as escaped text. Human
acceptance does not silently resolve or remove them.

Frozen briefs retain these questions in their existing uncertainties field and
Markdown body. The existing 16-item uncertainty limit includes two general
caveats, leaving room for 14 submitted questions. Exceeding it returns
`limit_exceeded` atomically; nothing is omitted. Existing aggregate publication
and tool-result byte limits remain enforced.

## Verification

- `bun install --frozen-lockfile`: exit 0, no dependency changes.
- `bun run codegen`: exit 0; 20 schemas, 35 validators, 18 operations and
  17 MCP tools regenerated from the contract.
- `bun scripts/operations-doc.ts --write`: exit 0.
- `bunx vitest run tests/domain/contract-unknowns.test.ts tests/domain/t10-proposals.test.ts tests/domain/t09-persistence.test.ts`:
  exit 0, 32 tests across three files.
- `bun run verify`: exit 0, 744 tests across 53 files, including contract drift,
  formatting, TypeScript and production build checks.

The real-handler cases cover publication, replay, changed-argument conflicts,
human acceptance, investigation reads, frozen brief reads, cross-user denial,
aggregate-size rollback and brief-capacity rollback. Generated-validator tests
cover omitted/empty/populated values and malformed or oversized questions.

During development, the gate first caught an unregenerated operations document,
then a TypeScript mismatch with the generated bounded-array type. Both were
corrected before the successful full run. One initial test used the wrong
decision-kind literal; the generated validator rejected it and the fixture was
corrected to `acceptance`.

## Status and limits

**Local real handlers** via convex-test. This branch did not write to the demo,
identity-acceptance or deployed Convex backend. Live host, browser rendering and
deployment of this change are **NOT RUN**. Prior rejected submissions cannot be
recovered; clients must resubmit them after deployment. Existing saved briefs
remain frozen.

Issue #51's separate suggestion to add a safe-window hint to oversized
`readSource` errors remains outstanding. This change addresses the unknowns
contract/handler mismatch only.
