# T08 HTTP transport and OAuth activation evidence

## Status

HTTP/MCP adapters and policy tests: **local real handlers via convex-test**.
Built Node route smoke tests: **local HTTP**, unauthenticated requests only.
AuthKit discovery/JWKS: **live public provider metadata**, read-only.
Real OAuth access token, browser consent, subject comparison and remote MCP host:
**NOT RUN**. PR #42 stays draft pending that evidence. Neither running Convex
backend (3210 demo, 3220 identity acceptance) was changed or called by this work.

The initial PR #42 commit used the browser session profile for both endpoints.
The amended implementation separates them; that initial commit must not activate
remote MCP. The handlers fail closed without explicit OAuth configuration.

## Token profiles and principal consequences

- `/api/ops/:operationId` accepts the existing WorkOS browser session profile:
  issuer `https://api.workos.com/user_management/<WORKOS_CLIENT_ID>`, JWKS
  `https://api.workos.com/sso/jwks/<WORKOS_CLIENT_ID>`, RS256. The prior I01 real
  session test observed no audience claim. This PR does not claim to repeat it.
- `/api/mcp` accepts only an OAuth access token: exact configured AuthKit issuer,
  `/oauth2/jwks`, RS256, **required audience equal to `MCP_RESOURCE_URL`**.
  Browser session tokens, missing audience and client-ID fallback audiences fail.
- Both check signatures, issuer, expiration and required subject/issued-at claims;
  neither accepts identity from tool arguments. The original bearer token reaches
  Convex unchanged. Convex must independently trust the matching token profile.
- `issuer|subject` remains the principal key. Even identical subjects under the
  two issuers are distinct principals with distinct grants/receipts. Tests prove
  there is no implicit identity linking. A shared-portfolio policy requires a
  separate reviewed decision; this PR does not normalize issuers or widen grants.

## Read-only provider checks (2026-09-20)

The supplied staging domain, `https://devoted-ship-74-staging.authkit.app`, returned
200 for `/.well-known/oauth-authorization-server`,
`/.well-known/openid-configuration` and `/oauth2/jwks`.

Observed metadata: issuer is that AuthKit origin; authorization `/oauth2/authorize`;
token `/oauth2/token`; JWKS `/oauth2/jwks`; PKCE S256; public token authentication
`none` as well as secret methods; OIDC subject type `public`; one RSA/RS256 signing
key. Neither a registration endpoint nor CIMD support was advertised at this check.
No key material or access token was printed. Discovery is not access-token proof.

Official references: [WorkOS MCP](https://workos.com/docs/authkit/mcp),
[WorkOS Connect OAuth](https://workos.com/docs/authkit/connect/oauth),
[WorkOS metadata](https://workos.com/docs/reference/workos-connect/metadata).
The installed implementation uses MCP SDK **1.30.0** (native Web Standard
Streamable HTTP and OAuthClientProvider/auth APIs) and jose **6.2.12**. No dependency
was added; no protocol schema or operation registry fact was copied into adapters.

## Before the real consent test

1. In WorkOS Connect configuration, register exactly
   `https://think-wide.fbf.systems/api/mcp` as a Resource Indicator. WorkOS documents
   that without configured indicators, the resource parameter is ignored and
   audience falls back to the environment client ID; our verifier rejects that.
   A default indicator is optional for hosts that omit `resource`.
2. Enable CIMD for hosts that support it and DCR for compatible clients. The probe
   below uses DCR, or an explicitly pre-registered **public** client via
   `MCP_PROBE_CLIENT_ID`. Its callback is `http://127.0.0.1:3183/callback` and token
   authentication is `none`, with SDK-owned S256 PKCE. It needs no client secret.
3. Re-read discovery to confirm the configured registration endpoint. Obtain a
   real OAuth token through consent and verify the issuer, algorithm, resource
   audience, lifetime and subject relationship before production activation.
4. Coordinate the independent Convex OAuth provider with I01. The browser session
   provider alone cannot verify this other issuer. This PR does not edit
   `convex/auth.config.ts` and does not install a provider on either live backend.

## Explicit live probe

From this branch, on the machine whose browser receives the loopback callback:

```bash
MCP_AUTHORIZATION_SERVER=https://devoted-ship-74-staging.authkit.app \
MCP_RESOURCE_URL=https://think-wide.fbf.systems/api/mcp \
bun --no-env-file tests/adapter/t08-http-oauth-probe.ts
```

The installed SDK performs registration, resource selection, PKCE, authorization
and code exchange. Open the printed authorization URL and complete consent.
The callback binds only 127.0.0.1, validates the exact host/path and unpredictable
state, accepts one code, and shuts down on completion or timeout. Tokens, client
credentials, codes and verifier remain in memory and are never logged or saved.
Network calls are bounded; the consent wait is five minutes. Provider errors are
sanitized, not echoed.

The profile-only probe uses the SDK's documented out-of-band discovery-state
hook: it fetches live AuthKit discovery but supplies the intended resource from
configuration. This allows token verification **before** public app activation;
it does not prove the app's own metadata endpoint or Convex transport.

Observed preflight command above: **exit 1**, safely refused because discovery did
not advertise DCR and no pre-registered client was supplied. No browser flow or
token exchange happened; this is a concrete prerequisite, not a passing test.

Successful output includes verified `iss`, `aud`, algorithm, lifetime and SHA-256
of the subject. Optional `WORKOS_SESSION_TEST_TOKEN` and `WORKOS_CLIENT_ID`, supplied
privately to the process, compare a separately verified current browser session:
only `browserSubjectMatches` and `convexTokenIdentifierMatches` booleans are printed.
Do not paste a token into a shell command, issue, chat or evidence file.

After reviewed activation and the independent Convex provider are in place, repeat
with `--call-mcp`. That additionally uses the real HTTP client to assert the
generated tool inventory and call `getCapabilities`. It performs no business
mutation, imports no repositories and does not manufacture a principal/grant.
Claude.ai/ChatGPT acceptance remains a separate real-host run.

## Application configuration and bounded behavior

The app requires `THINK_WIDE_MODE=connected`, existing HTTPS Convex URL,
`WORKOS_CLIENT_ID`, `MCP_RESOURCE_URL` and explicit `MCP_AUTHORIZATION_SERVER`.
Missing OAuth issuer disables MCP and metadata with 503; browser API remains
independently configured. All HTTP routes are disabled in local-demo, including
loopback; local stdio is unchanged. No local fixed principal is exposed.

Resource metadata advertises the exact resource, configured authorization server
and bearer header method. Missing/invalid MCP tokens receive 401 plus a metadata
challenge. The browser API uses its own Bearer realm, so its 401 never directs
a session client to the different MCP OAuth profile. Host/Origin checks use configured authority; the private HTTP app can
sit behind Caddy TLS. Forwarded headers never select a trusted authority.

The MCP transport is stateless JSON request/response: no session reuse, GET stream,
resumability or batch calls. Each request receives a fresh server and bearer token.
Actual body bytes and nesting are bounded before SDK/schema processing. The
131072-byte cap includes the MCP envelope, so maximum tool arguments are slightly
smaller than the direct operation limit. Responses are no-store.

## Checks performed

- First transport gate: `bun run verify` exited 0, 616 tests / 43 files.
- Amended profile targeted suite: `bunx vitest run tests/adapter/t08-http-transport.test.ts`
  exited 0, **37 tests**. It exercises real signed JWT verification, both profiles'
  denial cases, strict MCP audience, same-subject issuer isolation, real Convex
  handlers, decisions, receipts, revocation, malformed/deep/oversized bodies and
  metadata/authority guards. Only JWKS HTTP and the Convex network leg are
  substituted; authorization is not mocked.
- Initial built Node routes on disposable port 3182, behind Caddy-style Host and
  forwarded-proto headers: MCP and operation endpoint 401 with challenges,
  metadata 200. The temporary server was stopped. These checks preceded the
  OAuth-profile amendment; they do not prove the amended OAuth consent flow.
- Vite generated `src/routeTree.gen.ts`; it was not hand-edited. Public bundle
  scan found no JWKS URL construction, WORKOS_CLIENT_ID or verifier implementation.
