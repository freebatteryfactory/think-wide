# Deployment-attested capability reporting

`getCapabilities` no longer treats all connected installations as locally tested,
or treats the deployed MCP endpoint as permanently untested. Two optional **Convex
deployment environment** values record operator-attested acceptance for that exact
installation:

- `THINK_WIDE_EVIDENCE_HOSTED_IDENTITY`
- `THINK_WIDE_EVIDENCE_REMOTE_MCP`

Both default to `not_run`, including on connected installations. Accepted values
come from the generated Capabilities validator / CapabilityStatus definition:
`not_run`, `disabled`, `local_only`, `live`. An empty, misspelled or unsupported
value fails response validation; it is never coerced to a success status. Local
demo mode always reports these two integrations `not_run`, even if copied
production settings say `live`. No request argument can set these values.
Other integrations remain unchanged: GitHub App `not_run`; issue publication,
backend reasoning and outcome ingestion `disabled`; search modes empty.

## Operator procedure

1. Record actual acceptance and its release, deployment and evidence source in the
   deployment ticket. These are acceptance records, **not automatic health checks**.
2. On only that accepted backend, use Convex CLI 1.46's existing environment API:

   ```sh
   bunx convex env set THINK_WIDE_EVIDENCE_HOSTED_IDENTITY live --env-file /private/path/backend.env.local
   bunx convex env set THINK_WIDE_EVIDENCE_REMOTE_MCP live --env-file /private/path/backend.env.local
   ```

3. Read `getCapabilities` with a normal verified user token after deploying this
   change. Browser-session calls report `workos-authkit`; MCP calls report
   `workos-mcp-resource` when their verified `tokenIdentifier` starts with the exact
   configured MCP issuer plus `|`. Request fields never determine the profile.
4. Reset the relevant value to `not_run` when moving to an untested deployment,
   losing applicability of the recorded evidence or needing reacceptance; use
   `disabled` when the integration is deliberately off. Do not copy acceptance
   values as generic defaults into private or local installations.

No operator commands or existing-backend changes were performed by this branch.
The default stays conservative until an operator explicitly attests the evidence.

## Evidence supporting the production operator's choice

Issue [#26](https://github.com/freebatteryfactory/think-wide-hackathon/issues/26)
records independently exercised deployed WorkOS browser login and the SDK's real
OAuth registration/consent → deployed MCP → Convex tools/list/getCapabilities
round trip. Those support `live` for their respective integration on that
production deployment. The later full ChatGPT catalog/source/proposal loop was
**reported by the owner**, not observed by this implementing agent or coordinator.
Claude.ai and Safari remain **NOT RUN**. One integration-level `live` value does
not claim that every host/browser or every operation was exercised.

## Verification

`bunx vitest run tests/domain/t08-capabilities.test.ts`: **21 tests passed** through
real Convex handlers and the operation pipeline. Cases include every contract
status, invalid config, conservative/local defaults, verified-issuer profile
selection, absent identity and request-field smuggling. `bun run typecheck` exits
0. The full gate result is recorded below after completion. No auth configuration,
contract, generated output, dependency, frontend or deployment changes are made.

Full gate on main `73d3a9f`: `bun run verify` exited **0** with **52 test files /
754 tests passed**, no contract drift, TypeScript and production Vite build passed.
This is local real-handler verification. Applying the attestation values and
checking the new response on the deployed service remain operator work, NOT RUN
by this branch. No new live-host acceptance is claimed.
