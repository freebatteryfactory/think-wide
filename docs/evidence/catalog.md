# F: shared public demo catalog

## Operator command

```sh
bun run catalog:seed --env-file /private/path/admin.env.local \
  --owner 'https://issuer.example|operator-subject' \
  https://github.com/example/public-repository@FULL_COMMIT
```

Supply one to eight public HTTPS Git URLs, optionally suffixed with a full
lowercase SHA-1/SHA-256 commit. Without a suffix, the command resolves default HEAD
once and pins it. Save the sanitized JSON output (URL, full commit, snapshot ID,
cache counts). Use those pins on reruns. The explicit environment file must name a
self-hosted HTTPS endpoint or literal HTTP loopback and its admin credential. This
is trusted operator ingestion, not end-user GitHub account import or caller auth.
The catalog is advertised only after that URL's registration/cache steps succeed;
earlier completed URLs remain if a later URL fails. Repeated exact pins preserve
the original indexing timestamp and replay immutable registration.

### Concrete bounds and network policy

- Public IPv4 DNS answers only, pinned into Git/libcurl for every network command;
  HTTPS port 443 only. No credentials, query, fragment, redirects, inherited Git
  config, proxy, helper, hooks, submodules or target checkout/execution. IPv6-only,
  authenticated, redirected or private-network repositories are unsupported.
- Linux `/usr/bin/prlimit` is required: 32 MiB per output file, 10 CPU seconds,
  128 open files. `fetch.unpackLimit=1` forces fetched objects into a bounded pack
  rather than arbitrarily many loose object files. Each existing `runGit` call has
  a 5-second wall clock and bounded output; rejection kills its process group.
- Existing reader bounds still apply (32 MiB bundle, 5,000 entries, 1 MiB blobs).
  CLI arguments are at most 112 KiB. Blobs above 48 KiB are explicitly counted as
  uncached; exact reads of uncached data return `source_unavailable`. History
  caches at most 20 commits and reports incompleteness. The full history fetch
  may reject large repositories before these downstream limits are reached.
- At most eight published snapshots. Claims have the common 16 KiB result cap;
  oversized metadata fails atomically. There is no silent truncation or catalog
  pagination. Operator removal/re-add changes epoch and does not restore old
  reader grants. Existing manual owner grants retain their authority.

Git 2.43.0 was checked against its versioned
[configuration documentation](https://git-scm.com/docs/git-config/2.43.0)
(`fetch.unpackLimit`, `http.curloptResolve`, redirect policy) and
[fetch documentation](https://git-scm.com/docs/git-fetch/2.43.0).
Convex CLI 1.46.0 uses the existing internal operator provisioning functions;
public claims still use verified JWTs and the standard operation wrapper.

## Verification

Local real-handler tests cover two identities claiming the same three snapshots;
private investigation, decision and brief denial; reader cache-write denial;
noncatalog snapshot denial; revoked grants; catalog withdrawal and epoch changes;
late publication supersession; manual-owner preservation; receipt IDs and frozen
sets; missing identity and smuggled arguments. URL/IP rejection tests are local.

The coordinator independently ran the bounded fetch worker over public MIT
repositories on 2026-09-20: p-limit at
`a8a6fbec4e0e866d6d779b10889bb4f5567e70eb` (explicit pin, 68,848-byte bundle),
p-queue at `180ab9e25cd10b6f548767d7176076b50d25e188` (HEAD resolved once,
287,324-byte bundle), and p-timeout at
`8bbf53936a8e2fc5e1566cf399afbcbf53ddefb5` (HEAD resolved once, 61,153-byte bundle).
All three exited 0 under the stated resource limits; temporary directories were
removed. This proves the public Git fetch path, not hosted account access.

Full gate and disposable-backend seed/verified-JWT acceptance results follow. Production catalog publication and hosted WorkOS account
acceptance are NOT RUN by this branch. No shared backend or VPS is mutated.

### Final local gate

After merging `origin/main` at `30b4ea3` (I01), `bun run verify` exited 0:
48 test files, 664 tests passed, no generated contract drift, TypeScript and Vite
production build passed. This includes 8 catalog handler tests, 31 URL/IP cases
and the catalog contract test. Earlier gate attempts exposed obsolete version,
envelope-count and uniqueness assertions; those now explicitly permit the two
operations sharing the projects envelope. No test is skipped or auth mocked.

The coordinator ran `bunx convex dev --once --env-file /tmp/think-wide-catalog-acceptance-kv5cxtxc/admin.env.local` against the disposable loopback
backend on port 43320: exit 0 (2.93 seconds). This regenerated the Convex API and
proved the generated validators bundle with the catalog handler. Shared backends
3210/3220 and the VPS were not used for these writes.


### Disposable backend and MCP acceptance (coordinator-run)

The coordinator ran `bun run catalog:seed --env-file
/tmp/think-wide-catalog-acceptance-kv5cxtxc/admin.env.local --owner
'https://operator.example|catalog-owner'` with the three complete public HTTPS
GitHub URLs above, each suffixed with its recorded full commit. Exit **0**:
p-limit cached 16 blobs, p-queue cached 23 with one explicitly uncached oversized
blob, and p-timeout cached 13. All three reported `historyComplete: false`.

`/tmp/catalog-live-acceptance.ts` exited **0**, using the real SDK stdio transport
for principal A and SDK in-memory transport for B, with independently signed
verified local JWTs against disposable backend 43320. The run checked:

- Exactly 17 generated MCP tools; both principals claim the same three snapshots;
  receipt replay returns the same result.
- Exact `index.js` source equals the bytes from each pinned public GitHub commit;
  SHA-256 source digests and Git blob SHA-1 match.
- Investigations, decisions, runs and briefs remain private across accounts.
- Correction advances revision, fences late work, survives replay, and changed
  decision arguments conflict.
- Public calls cannot invoke operator provisioning. The deployed function spec
  marks all five operator functions internal.

The first acceptance attempt's final assertion expected development error text;
the backend redacted it. The assertion was corrected to check actual rejection
and deployed visibility, and the complete probe passed on rerun. No authorization
was changed. Status is **local real handlers + live public Git + local MCP
transport**, not hosted WorkOS users, remote MCP OAuth, or production deployment.


The coordinator repeated exact pinned seed ingestion: exit **0**, identical three
snapshot IDs and cache counts. After the I01 merge, they configured only the
isolated backend with a non-secret unused WorkOS client placeholder (local-demo
still trusts only its local issuer) and repeated `bunx convex dev --once
--env-file /tmp/think-wide-catalog-acceptance-kv5cxtxc/admin.env.local`: exit **0**,
2.57 seconds. The complete real acceptance probe then passed again against those
final functions. No hosted provider trust or shared-backend setting was changed.


### Review follow-up scope

The live seed/MCP acceptance above exercised code at `542327a`; later review
fixes were verified with real-handler tests and the full gate. They reject the
IANA special-purpose `192.88.99.0/24` block, prefer valid manual grants at run
admission while retaining exact grant-ID/epoch fences, group multiple snapshots
of one repository in the claim response, and require an explicit `--env-file`.
The [IANA IPv4 special-purpose registry](https://www.iana.org/assignments/iana-ipv4-special-registry/)
was checked for the full non-global ranges; protocol-assignment /24s remain
conservatively excluded even where individual globally reachable exceptions exist.

The coordinator removed only the disposable acceptance containers, volumes and
temporary credentials after testing. Shared backend containers remained running.
No further live-backend testing was performed for these narrow review fixes.

The generated MCP tool and shared operation are available for a connector's first
call. Automatically claiming the catalog after website login is **not wired by
this branch**; that UI integration remains with Claude's website/identity work.
Arbitrary end-user URL import remains the separate B plan; this branch accepts
pasted URLs only through the trusted operator CLI.

Final follow-up gate, after merging main `672038f` and the four review fixes:
`bun run verify` exited **0**, **50 test files / 683 tests passed**, no contract
drift, TypeScript and production build passed. Catalog-specific coverage is now
12 real-handler tests, 34 selection/CLI cases, and one contract test. The added
manual-grant tests prove publication survives catalog withdrawal when admitted
under existing manual authority, but still supersedes on that manual grant's
epoch change or revocation. No extra hosted/OAuth/deployment acceptance is claimed.
