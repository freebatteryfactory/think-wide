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

Full gate and disposable-backend seed/verified-JWT acceptance results are recorded
below when actually run. Production catalog publication and hosted WorkOS account
acceptance are NOT RUN by this branch. No shared backend or VPS is mutated.

### Final local gate

After merging `origin/main` at `30b4ea3` (I01), `bun run verify` exited 0:
48 test files, 664 tests passed, no generated contract drift, TypeScript and Vite
production build passed. This includes 8 catalog handler tests, 31 URL/IP cases
and the catalog contract test. Earlier gate attempts exposed obsolete version,
envelope-count and uniqueness assertions; those now explicitly permit the two
operations sharing the projects envelope. No test is skipped or auth mocked.

The coordinator ran `bunx convex dev --once` against the disposable loopback
backend on port 43320: exit 0 (2.93 seconds). This regenerated the Convex API and
proved the generated validators bundle with the catalog handler. Shared backends
3210/3220 and the VPS were not used for these writes.
