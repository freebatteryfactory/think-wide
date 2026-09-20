# 0004 — Trusted source import jobs

Status: accepted direction; **design only, not implemented**.
Owner: @heyoub. Follow-up: issue #21; provider connectivity: I02.
Depends on [0001](0001-contract-source.md), [0002](0002-operation-pipeline.md),
and the internal operator provisioning merged in PR #29.

## Decision

A public import is three steps:

1. `requestImport` validates a small source-selection request, derives the owner
   exclusively from verified `ctx.auth`, authorizes the selected source connection,
   and records a durable import job in Convex.
2. A trusted Node worker reads that source using the existing bounded Git reader.
3. A job-authorized completion transaction registers the verified snapshot for
   the job's recorded owner through the existing T05 storage primitive.

A user token proves who requested work. It does not prove that uploaded entries,
commit IDs, byte ranges or content came from the trusted reader. Therefore public
requests never contain a caller-authored snapshot tree or an owning principal.
Login, including WorkOS login, does not grant permission to manufacture evidence.

## Reuse the existing parts

- Contract schemas and `operations.json` remain the source for generated request
  types, validators, operation bindings and any adapter exposure. This decision
  adds no contract entry; the implementation ticket must add them through codegen.
- The public request uses the existing operation pipeline, generated validation,
  verified principal and receipts. Its stable result is a job ID; replay checks
  current authorization and returns that ID, never a cached private body.
- Convex owns job state, receipts, grants and atomic state transitions. No second
  queue/database owns import state. Workers may claim bounded pending work from
  Convex through authenticated operations; no new queue service is required.
- Node owns Git/filesystem work. Reuse T05's immutable snapshot and exact-byte
  validation, bounded source/history caches and read-only Git invocation rules.
- Reuse `registerSnapshotForPrincipal`, `cacheSourceForPrincipal` and
  `cacheHistoryForPrincipal` behind trusted job checks. The recipient is derived
  from the stored job, never from worker-supplied owner metadata.

## Service authentication is not administrative access

The worker authenticates with a dedicated service identity accepted through a
separate reviewed `customJwt` provider. Give it a distinct issuer, signing keys,
explicit worker audience, short expiry and independently revocable authority.
It is not a human principal and cannot acquire arbitrary human snapshot grants.
The app server and worker do not receive the Convex admin key.

A service JWT **cannot directly invoke an internal Convex function**. The future
implementation needs an authenticated worker-facing completion entry point,
registered through the existing policy architecture. That entry point checks
service authority, job ownership of the claim and all fences, then delegates to
an internal transaction/shared storage helper. Service tokens must be rejected by
ordinary user operations; ordinary user tokens must be rejected by worker
operations. This capability separation needs explicit policy and tests, not just
another trusted issuer or a hidden route.

Today's `operatorProvisioning` functions stay internal and administrative. They
reject user auth contexts and intentionally trust an administrator to choose a
recipient. They must not be made public or have that guard weakened to admit the
worker. Reusing their underlying completion/storage logic preserves the work
from option (a) while keeping the narrower job boundary of option B.

Convex's documented [internal-function visibility](https://docs.convex.dev/functions/internal-functions)
and [custom JWT provider](https://docs.convex.dev/auth/advanced/custom-jwt) are
separate mechanisms. The installed baseline for this design is Convex 1.46.0;
provider audience verification uses `applicationID`. WorkOS's human session token
shape does not determine the new worker token's audience policy.

## Job state and transaction boundaries

The implementation ticket must specify and generate bounded job/operation shapes.
At minimum, durable state binds the verified requester, approved source identity,
requested revision/selector, request digest, current source authorization fence,
worker claim/attempt and resulting snapshot IDs. Provider secrets stay outside
request arguments and persisted job bodies.

Claim work atomically. A claim belongs to one authorized service principal and a
specific attempt with a bounded lease. After lease expiry a new claim increments
the attempt; late results from the old attempt cannot publish. A client-supplied
job ID, claim ID or lease value is not itself authority.

At completion, in the same transaction as registration:

- Require the current service authority and matching active job claim/attempt.
- Load the requester/source from the job; check that source permission still
  exists and its epoch matches admission. Revocation fences completion.
- Bind the reader's output to the job's approved source and resolved full commit.
  Reject source substitution and incompatible immutable snapshot metadata.
- Run the existing snapshot/entry validations; grant the resulting snapshot only
  to the job's requester, never to an owner from a completion payload.
- Persist the result IDs and terminal job state atomically. Same completion and
  digest replays those IDs; conflicting output fails without another effect.

Cache uploads may need multiple bounded transactions, as they do today. The job
must distinguish registered metadata from available exact bytes and histories;
partial imports cannot claim completeness. Each upload checks its claim and job
source again. Retrying must not restore a revoked grant, overwrite immutable
metadata or expose partially cached bytes as an exact read. Cancellation prevents
future publication; it does not claim to undo a Git read already dispatched.

## Reader and provider boundary

A public request selects an approved source connection and a bounded revision,
not an arbitrary filesystem path, credential, executable or shell command. The
reader must prevent arbitrary-network/SSRF access, path escapes and Git option
injection. Target repo hooks/configuration/AGENTS files remain untrusted data.
No target code is installed, executed, tested or modified.

Evaluate WorkOS Pipes for GitHub connection consent, credential retrieval and
refresh in I02. Regardless of provider, it does not replace source authorization,
trusted reading, job fencing or evidence validation. Neither Pipes nor a new
provider dependency is installed by this decision.

## Acceptance before enabling public imports

- Missing/invalid human identity cannot create a job; supplied owner, service
  identity or snapshot-tree fields fail generated request validation.
- A foreign job/source has the same missing-object response as a nonexistent one.
- Duplicate requests/completions return stable IDs; changed arguments conflict.
- Human tokens cannot claim/complete; service tokens cannot use user operations;
  public clients cannot invoke the internal operator functions.
- Revoke source permission, worker authority or a claim; bump an epoch or expire
  and replace a lease: every late completion is rejected without granting data.
- Rebind a source, recipient, revision or cached entry in the completion: reject.
- Interrupted caching reports its actual completeness; retries preserve exact
  bytes, existing decisions and revoked grants.
- A real authenticated user imports an approved source through the Node reader,
  then browses and reads exact bytes through the ordinary operation pipeline.

All of these checks are **NOT RUN** for option B. PR #29's local operator setup
and synthetic source-to-brief evidence remain the only delivered import path.
This decision neither activates the VPS nor establishes remote MCP OAuth.
