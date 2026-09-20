# 0002: One operation pipeline, inside the Convex transaction

Date: 2026-09-20 · Owner: Eassa · Reviewer: Andrew · Status: accepted · Implemented by T06

## The three facts that decide it
1. A Convex mutation is one atomic transaction. It is the only place where a check and the write it guards happen with no gap.
2. Several doors lead to the same data: HTTP, MCP, any CLI, and a Convex client wired into the browser. Policy in the Node gateway can be walked around; policy in the Convex functions cannot.
3. The product promise is that a human decision outlives stale machine work. Any mechanism that can lose or overwrite a decision breaks the product.

## Decision
Every public Convex function is registered through one wrapper, `convex/lib/operation.ts`, keyed by `operationId` from `generated/operations.ts`. In this order, inside the same transaction:

1. validate the single `request` argument with the generated validator
2. derive the principal from `ctx.auth` only
3. for state-changing operations, reserve or replay the receipt
4. call the handler with an already authorized context
5. validate the response with the generated validator, including `kind === envelopeKind`, then each envelope entry with the operation's registered entry validator (`entriesType`)
6. finalize the receipt

Handlers never touch protected tables through raw `ctx.db`. They use `loadAuthorized(kind, id)` / `queryAuthorized(...)` from `convex/lib/authz.ts`, which return the document or throw `not_found`.

## The five responsibilities
| # | Rule | Why the alternatives lose | Bucket |
|---|---|---|---|
| 1 Identity | Only from `ctx.auth`. Request schemas forbid identity fields. | "Pass the user in the request for now" is a bypass that outlives "for now". | Structural |
| 2 Grants | One accessor. Ownership is a grant row written in the mutation that creates the object; no separate owner field grants access. Missing and forbidden share one code path and one error. | Two access mechanisms are two places to revoke. | Runtime policy at one point, plus a test that fails on raw `ctx.db` access to protected tables outside `convex/lib/` |
| 3 Decisions | Optimistic concurrency: compare `expectedRevision` in the mutation. Decisions are append-only rows; revision is a counter. | Last-write-wins loses human decisions. Locks need leases. Event sourcing is unearned complexity. | Runtime policy |
| 4 Receipts | Key = principal + operationId + requestKey. Store the argument digest and result IDS, never bodies. Replays re-read through the accessor. | Storing bodies creates "replay after revocation leaks private data" and a special case to patch it. | Emitted evidence that also enforces |
| 5 Run fencing | Capture base revision + grant epochs at admission as a fencing token; the publication mutation compares it. | "Cancel the job when the human decides" cannot stop an action already in flight. Cancel is a courtesy; the fence is the guarantee. | Runtime policy + evidence (`superseded`) |

## Grant model as settled by T06 (PR #12)
`grants` rows are `{principal, resourceKind: "investigation" | "snapshot", resourceId, role: "owner" | "reader", epoch, revokedAt?}`. No repository, entry, finding, decision or run grants: decisions, runs and findings derive access from their parent investigation, which re-checks its snapshots. A source ref is authorized iff its `snapshotId` is in the investigation and the caller holds a current grant on that snapshot. `reader` permits operations whose registry `effect` is `read`; `owner` permits all, so a new operation needs no data migration. Role gates mutation of the granted resource; a snapshot is only ever an input, so any current snapshot grant authorizes using it. The admission fence is the investigation grant plus its snapshot grants with their epochs; a run may cite new evidence inside that fenced set and nothing outside it. T05 writes one `snapshot` grant, role `owner`, in the mutation that registers the snapshot.

## Still a judgment call
- Grant granularity: per snapshot today, because that is the narrowest level the demo needs. Widen only when real use forces it.
- Whether the browser talks to Convex directly or only through the Node app: a deployment choice for I04. T06 is identical either way, which is the point of putting policy at the data layer.
- How the running `local-demo` app obtains an identity (tests use convex-test identities): not T06. Expected answer is a local dev JWT issuer the self-hosted Convex trusts, scoped under I01 or T08.

## Acceptance it must satisfy
Q01, Q03, Q06, Q07, Q14 in 05_SECURITY_AND_CI.md. An adversarial QA round follows implementation.

## Operator provisioning exception (PR #29, issue #21)

Accepted by the owner for local setup: an internal-only operator provisioning
mutation may explicitly name the owning principal by its **full Convex
`tokenIdentifier`**, preserving `issuer|subject` exactly. This is recipient data
chosen by an administrator, equivalent in trust to a direct database write with
the admin key. It is never a substitute for authenticating a public caller.
A bare provider user ID is invalid. Recipient syntax is checked; existence in an
identity provider is not inferred from a well-formed string. An administrator can
intentionally provision another well-formed recipient, as part of this authority.

`convex/operatorProvisioning.ts` exposes only internal mutations for registration,
source-cache completion and history-cache completion. They reject a user auth
context, never appear in `OPERATIONS` / `MCP_TOOLS`, and reuse T05's existing
validation and storage helpers. Existing identity-based ingestion functions keep
using `ctx.auth`; public operations and their policy pipeline are unchanged.
Replays still require the recipient's current owner grant; revoked grants are
never recreated and immutable registration metadata cannot be overwritten.

`scripts/local-setup.ts` is a trusted operator CLI. It is non-production,
local-demo and literal-loopback only. It accepts no owner/source arguments, verifies
the local issuer's JWT, derives the recipient from those verified claims, and
imports the committed synthetic alpha/beta bundles with the admin CLI. Normal
MCP traffic uses user JWTs and never the admin key. Registration, blob caching
and history caching are separate bounded transactions: interrupted setup is
resumable, not an atomic import of the entire portfolio.

The historical CLI `--identity` route could not reach internal functions on the
pinned backend. This exception resolves the deliberate operator boundary rather
than introducing a public upload of caller-asserted Git metadata.

### Later public import path (B; not implemented by PR #29)

The intended sequence is a public `requestImport` operation which stores the
owner from verified identity and creates an import job; a trusted Node reader
performs bounded Git work; trusted completion uses the shared registration
primitive for that job's recorded owner. Completion must bind the job, source,
recipient and current authorization before committing data.

The worker should use a dedicated service identity accepted through a separate,
reviewed JWT provider; the app server must never hold the admin key. A service JWT
alone does **not** make an internal Convex function callable by an external client.
That future ticket must implement an authenticated worker completion entry point
which checks service authority and the job, then invokes the private primitive.
Today's operator entry points remain administrative and reject ordinary user
contexts. No new provider, import job, worker endpoint or public ingestion
operation is delivered here. WorkOS Pipes/GitHub connectivity belongs to I02.

## Public demo catalog exception (F, owner authorized)

The operator may mark an already registered `dataLabel: public` snapshot as a demo
catalog member through an internal-only mutation. This mutable publication flag
and its epoch are excluded from T05's immutable registration digest. Only an
existing, non-revoked manual owner grant permits the operator change; ordinary
user auth contexts are rejected by the existing provisioning boundary.

A verified caller may run `claimDemoAccess` without supplying any source or
principal identifier. In one transaction it creates missing **reader** snapshot
grants for current catalog members. Existing manual grants are preserved exactly;
no claim upgrades a role. When both are valid, access selects a manual grant
before a catalog grant, and admission fences that exact selected grant ID/epoch.
Each new catalog grant carries the publication epoch in
addition to its normal grant epoch. Every read/access and late publication checks
that catalog membership and epoch remain current. Withdrawal or removal/re-add
invalidates prior catalog grants; manual grants retain their explicit authority.

Revoked grants and stale catalog grants are tombstones: neither the same request
key nor a fresh one restores them. Conservatively, any such tombstone among the
currently published catalog members rejects the entire new claim, even if another
manual grant exists. An operator must resolve that situation explicitly; self
service never repairs it. Withdrawal can leave other catalog members claimable.
Receipts contain only a digest and a catalog-claim row ID. The claim row contains
principal, snapshot IDs and publication epochs, never cached response bodies.
Replays reload each snapshot through the authorized accessor and check the frozen
publication epoch. Existing run fences additionally reload the investigation and
all snapshots, so revoked catalog access commits a `superseded` internal outcome.

`scripts/catalog-seed.ts` extends trusted operator provisioning to intentionally
published public HTTPS Git selections. A URL alone resolves HEAD once; subsequent
work pins that exact commit. Optional `URL@FULL_COMMIT` makes reruns reproducible.
It uses the existing bounded Git reader without checkout or target execution,
completes bounded source/history caches, and advertises membership last. This is
an administrative CLI with an explicit CLI environment file and owner recipient;
no admin key enters app code. An internal-only operator query retrieves the
original indexing timestamp for exact immutable registration replay; it applies
the same recipient and manual-owner checks. It is not the future public import
path B.
