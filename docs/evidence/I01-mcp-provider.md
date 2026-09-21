# I01: resource-bound Convex OAuth provider

## Scope and evidence

The connected deployment can trust two independent profiles:

- Browser sessions: the existing client-specific WorkOS issuer, unchanged.
- MCP OAuth: the explicitly configured AuthKit origin, RS256, `/oauth2/jwks`,
  with `applicationID` **required** and equal to `MCP_RESOURCE_URL`.

Local-demo still selects only its local provider. Issuer plus subject remains
the principal; the two profiles are not linked into one account.

Checked the installed Convex **1.46.0** `src/server/authentication.ts` and
[Custom JWT documentation](https://docs.convex.dev/auth/advanced/custom-jwt).
`applicationID` is Convex's audience check; it is never omitted for MCP.

[Issue #17's real OAuth observation](https://github.com/freebatteryfactory/think-wide-hackathon/issues/17)
confirms the AuthKit issuer, JWKS and RS256. That token's audience is the WorkOS
environment client ID, **not** the resource URL. It does not qualify for this
provider or the HTTP MCP verifier. Resource Indicator configuration remains
necessary; sending `resource` alone did not change the issued audience.

## Deployment order (Claude owns production activation)

Use the operator's private `--env-file` pointing at the intended backend.
No credential belongs in the app or this document. Before pushing this auth
config to an existing connected deployment, set:

```sh
bunx convex env set MCP_AUTHORIZATION_SERVER '' --env-file "$operator_env"
bunx convex env set MCP_RESOURCE_URL https://think-wide.fbf.systems/api/mcp --env-file "$operator_env"
bunx convex dev --once --env-file "$operator_env"
```

An empty issuer disables OAuth while preserving browser login. **Missing is
not equivalent to empty in Convex:** an unset referenced variable prevents
deployment. The resource variable is read only when the issuer is enabled.

After WorkOS issues a token with the correct resource audience, enable:

```sh
bunx convex env set MCP_AUTHORIZATION_SERVER https://devoted-ship-74-staging.authkit.app --env-file "$operator_env"
```

Convex re-evaluates auth configuration on environment changes. Set the resource
**before** enabling the issuer. The app's environment must independently have
the same `MCP_AUTHORIZATION_SERVER` and `MCP_RESOURCE_URL`; setting Convex's
environment does not configure the app. Restart the app through the reviewed
production Compose procedure. Follow `T08-http.md` for the real OAuth/host probe.
The existing Connect public client ID is recorded on issue #17; DCR/CIMD still
needs dashboard configuration for hosts that require it.

Rollback disables only MCP: set the Convex issuer to `''` and remove/empty the
app issuer. Leave the browser WorkOS client ID and local-demo isolation intact.

## Commands actually run

All pushes used a fresh disposable backend at **127.0.0.1:43320**, with a private
temporary operator env file. No writes to 3210, 3220 or the VPS.

- `bun install --frozen-lockfile`: exit 0; no dependency changes.
- `bunx vitest run tests/domain/i01-auth-config.test.ts`: 24 tests passed.
- `bunx convex dev --once --env-file <disposable operator file>` with connected
  mode and the browser client ID but missing MCP issuer: exit 1, expected
  `Environment variable MCP_AUTHORIZATION_SERVER ... was not set`.
- Set issuer to `''`, repeat push: exit 0, functions ready in 2.29 s.
- Enabling issuer before the resource was set: rejected with
  `AuthConfigMissingEnvironmentVariable` naming `MCP_RESOURCE_URL`.
- Set resource first, then issuer, repeat push: exit 0, functions ready in 2.92 s.
- `bun run verify`: exit 0, **740 tests in 51 files**, contract drift clean,
  TypeScript and production build passed.
- Disposable backend, volumes and temporary credentials removed after testing.

These runs prove the exact bundle deploys with OAuth disabled and enabled, plus
the required environment migration order. They do **not** prove acceptance of
a real resource-bound WorkOS token. That and a real remote MCP host remain
**NOT RUN**. Provider-selection tests do not mock authorization or claim to
verify signatures; existing HTTP tests exercise signed JWT rejection separately.
