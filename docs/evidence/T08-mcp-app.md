# T08: read-only investigation view for MCP hosts (MCP Apps / ChatGPT)

Status level: **local real handlers**. Rendering inside real ChatGPT and inside real Claude.ai is **NOT RUN**.

## What a host sees

| Fact | Value |
|---|---|
| Bound tool | `readInvestigation` (only) |
| Tool `_meta` | `{"ui":{"resourceUri":"ui://think-wide/investigation-v1.html"},"openai/outputTemplate":"ui://think-wide/investigation-v1.html"}` |
| Resource URI | `ui://think-wide/investigation-v1.html` |
| Resource mimeType | `text/html;profile=mcp-app` |
| Resource `_meta` (list and read) | `{"ui":{"csp":{"connectDomains":[],"resourceDomains":[]},"prefersBorder":true}}` |
| Server capabilities | `{"tools":{},"resources":{}}` |
| Tool result | `structuredContent` = the validated response (unchanged), plus the existing text content |
| Unknown resource URI | `McpError` `-32602`, `Resource <uri> not found` (the SDK `McpServer` wording) |

All of these come from `contracts/operations.json` through `scripts/codegen.ts` into `generated/mcp-tools.ts`. `src/server/mcp/server.ts` restates none of them; it only maps a generated template name to its HTML source, and the `Record<McpUiTemplate, string>` type fails the build if a template has no source.

## Host protocols, verified from current documentation (2026-09-20)

The documentation differs from the ticket's expectations in one important way: ChatGPT no longer documents a separate `text/html+skybridge` resource type. The word "skybridge" does not occur on the Apps SDK "build MCP server", "build ChatGPT UI" or "reference" pages. ChatGPT now implements the MCP Apps standard and keeps `window.openai` as a compatibility layer. One resource and one mimeType therefore serve both hosts.

(a) How a tool declares its UI template

- MCP Apps (SEP-1865, `specification/2026-01-26/apps.mdx`): "Tools are associated with UI resources through the `_meta.ui` field" with `resourceUri?: string`. "The flat `_meta["ui/resourceUri"]` format is deprecated. Use `_meta.ui.resourceUri` instead."
- OpenAI Apps SDK, build ChatGPT UI: "For broader MCP Apps compatibility, use `_meta.ui.resourceUri`. ChatGPT also honors `_meta["openai/outputTemplate"]` as a compatibility alias."
- OpenAI reference: `_meta["openai/outputTemplate"]` is an "OpenAI-specific optional/compatibility alias for `_meta.ui.resourceUri` in ChatGPT."
- Emitted: both keys, same URI.

(b) URI scheme and mimeType

- MCP Apps: "URI MUST start with `ui://` scheme"; "`mimeType` MUST be `text/html;profile=mcp-app` (other types reserved for future extensions)"; "Content MUST be valid HTML5 document".
- OpenAI: "Expose the component as an MCP resource with the MCP Apps UI MIME type (`text/html;profile=mcp-app`)."
- OpenAI: "Treat the resource URI as a cache key. When you make a breaking change to the HTML, JavaScript, or CSS, publish a new URI and update every tool that references it." Hence the `-v1` in the URI.

(c) How the view receives the tool result

- MCP Apps: the View sends the `ui/initialize` request, then the `ui/notifications/initialized` notification. "The Host MUST NOT send any request or notification to the View before it receives an `initialized` notification." Then: "`ui/notifications/tool-input` - Host MUST send this notification with the complete tool arguments after the View's initialize request completes." and "`ui/notifications/tool-result`" with "`params: CallToolResult  // Standard MCP type`"; "Host MUST send this notification when tool execution completes".
- OpenAI mapping table: "Receive tool results | `ui/notifications/tool-result` | `window.openai.toolOutput`". "The compatibility aliases remain available for existing integrations. New UI should use the shared fields and bridge methods". Reference: "`window.openai.toolOutput` Your `structuredContent`." and the helper that "listens for host `openai:set_globals` events".
- Theme: MCP Apps `hostContext.theme?: "light" | "dark"` in the `ui/initialize` result and in `ui/notifications/host-context-changed` ("the View SHOULD merge received fields"). OpenAI: `window.openai.theme`.
- Implemented: both, from one document. The view always speaks the postMessage bridge when it has a parent, and also reads `window.openai.toolOutput` / `theme` at load and on `openai:set_globals` when that object exists. Rendering is idempotent, so a host that delivers through both paths is harmless.

(d) CSP and resource `_meta`

- MCP Apps: "If `ui.csp` is omitted, Host MUST use: `default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; connect-src 'none';`" and "Host MAY further restrict but MUST NOT allow undeclared domains".
- OpenAI reference: `_meta.ui.csp` "Standard widget CSP fields: `connectDomains`, `resourceDomains`, and optional `frameDomains`"; `_meta.ui.prefersBorder` "Hint for bordered card rendering"; `_meta.ui.domain` "Required for submitted plugins".
- Emitted: `csp` with empty `connectDomains` and `resourceDomains` (the view loads nothing and connects nowhere) and `prefersBorder: true`. `_meta.ui.domain` is not emitted: it is an app-submission requirement and needs an operator-chosen origin.

(e) `structuredContent`

- OpenAI example widget reads the result from `structuredContent`: `latestToolOutput = message.params?.structuredContent`. OpenAI, build MCP server: "A tool result can include: `structuredContent`: concise data the model can inspect and use in later calls. `content`: text or other MCP content that helps the model answer the user. `_meta`: client-specific data hidden from the model."
- MCP Apps: "Tools MUST return meaningful content array even when UI is available".
- The server already returned `structuredContent` (the validated response) and a text summary for every tool. Nothing changed there.
- Open doubt: OpenAI's reference says "Declare `outputSchema` for any tool that returns `structuredContent`." This server declares none today (a result is either the response shape or the error shape). Not changed in this ticket.

Installed SDK (`@modelcontextprotocol/sdk` 1.30.0): `ListResourcesRequestSchema`, `ReadResourceRequestSchema`, `McpError`, `ErrorCode.InvalidParams = -32602`; `server/mcp.js` throws `new McpError(ErrorCode.InvalidParams, \`Resource ${uri} not found\`)` for an unknown resource; `Server` refuses `resources/*` handlers unless the `resources` capability is declared. `capabilities.extensions` exists on the client schema; this server does not gate on it (a host without MCP Apps support ignores the `_meta`, per the spec's text-only fallback).

## What the view shows, and one gap

Question, status (in words), revision, timestamps and ids; snapshots in scope; human decisions first, in their own visually heavier section, with the line "Human decisions outrank every finding below."; then one card per finding with claim, evidence class, verification status, the claim's `unknowns` (contract 0.6.0, #51), extractor, and each evidence ref as repository + 12-character commit + display path (or entry id) + `[start,end)` bytes + 12-character sha256, with full values in `title` and in a "Full reference" expander. `unverified`, and any status the view does not know, gets a dashed border, a dashed badge and the word "Unverified"; it never receives the confirmed styling. A paged result shows a "Partial page" notice.

**Gap (PARTIAL):** the ticket asks for each snapshot as "repository + short commit". The `readInvestigation` response (`investigation.schema.json`) carries `snapshotIds` only. The view shows each snapshot id, and adds repository id and short commit only when an evidence ref in the same result names that snapshot. Nothing under `convex/` was changed, as instructed. Closing the gap needs a contract decision (for example snapshot summaries in the response).

Everything from the tool result is untrusted: written with `textContent` and `title` only. The view has no link, image, form control, button, tool call, storage or network use; `tests/structural/t08-mcp-app-widget.test.ts` enforces that on the source.

## Contract version

This change is contract **0.7.0**. It was authored as 0.6.0 from base `73d3a9f`; while it was in progress `main` took 0.6.0 for "preserve claim unknowns" (#51). `origin/main` was merged into the branch, the registry moved to 0.7.0, `generated/` was regenerated from the merged contract, and the view gained the new `Finding.unknowns` field. The version pins in `tests/domain/contract-*.test.ts` (including main's new `contract-unknowns.test.ts`) were moved to 0.7.0, as every earlier bump did.

## Commands and results

See the PR description for the exact commands and their real output from this change.

## Not run

- Rendering inside ChatGPT (developer mode connector): NOT RUN.
- Rendering inside Claude.ai / Claude Desktop: NOT RUN.
- Deployed `/api/mcp`: NOT RUN. `vite build` compiles the `?raw` import; the built server was not started.
