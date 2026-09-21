import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
	CallToolRequestSchema,
	ErrorCode,
	ListResourcesRequestSchema,
	ListToolsRequestSchema,
	McpError,
	ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
	MCP_TOOLS,
	MCP_UI_RESOURCES,
	type McpUiTemplate,
} from "../../../generated/mcp-tools";
import { CONTRACT_VERSION } from "../../../generated/operations";
import { OperationError } from "../../../generated/validators.js";
import { dispatch } from "../ops/dispatch";
import investigation from "./apps/investigation.html?raw";

/** HTML source of every generated view template, loaded once at module load.
 * The type fails the build when the registry names a template with no source here.
 * Views are static and identical for every caller: no token is read to serve them,
 * and all user data reaches a view only through the authorized tool call. */
const VIEW_HTML: Record<McpUiTemplate, string> = { investigation };

/** Low-level SDK registration preserves the generated JSON Schemas verbatim;
 * the high-level registerTool API requires another authored Zod shape. */
export function createMcpServer(token: () => Promise<string>) {
	const server = new Server(
		{ name: "think-wide", version: CONTRACT_VERSION },
		{ capabilities: { tools: {}, resources: {} } },
	);
	server.setRequestHandler(ListResourcesRequestSchema, async () => ({
		resources: MCP_UI_RESOURCES.map(({ template: _source, ...resource }) =>
			structuredClone(resource),
		),
	}));
	server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
		const view = MCP_UI_RESOURCES.find((item) => item.uri === params.uri);
		if (!view) {
			// Same code and wording as the SDK's own McpServer for an unknown resource.
			throw new McpError(
				ErrorCode.InvalidParams,
				`Resource ${params.uri} not found`,
			);
		}
		return {
			contents: [
				{
					uri: view.uri,
					mimeType: view.mimeType,
					text: VIEW_HTML[view.template],
					_meta: structuredClone(view._meta),
				},
			],
		};
	});
	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: structuredClone(MCP_TOOLS),
	}));
	server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
		const tool = MCP_TOOLS.find((item) => item.name === params.name);
		const response = tool
			? await dispatch(tool.operationId, params.arguments ?? {}, await token())
			: { code: "capability_disabled", message: "Operation unavailable" };
		const isError = OperationError(response);
		if (!response || typeof response !== "object" || Array.isArray(response)) {
			throw new Error("Invalid operation result");
		}
		const summary = Object.fromEntries(
			Object.entries(response).filter(
				([, value]) =>
					value === null ||
					typeof value === "number" ||
					typeof value === "boolean" ||
					(typeof value === "string" && value.length <= 128),
			),
		);
		const text = isError
			? JSON.stringify(response)
			: `${JSON.stringify(summary)}\nComplete result is in structuredContent.`;
		return {
			isError,
			structuredContent: { ...response },
			content: [
				{
					type: "text",
					text,
				},
			],
		};
	});
	return server;
}
