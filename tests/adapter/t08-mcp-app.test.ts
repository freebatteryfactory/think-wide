// The MCP adapter serves the generated view bindings and the static view template.
// A token source that throws proves that listing tools and reading a view never reads a token:
// the template is identical for everyone and all user data arrives through the tool call.
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { expect, test } from "vitest";
import {
	MCP_APP_MIME_TYPE,
	MCP_TOOLS,
	MCP_UI_RESOURCES,
} from "../../generated/mcp-tools";
import { createMcpServer } from "../../src/server/mcp/server";

async function connect() {
	let tokenReads = 0;
	const server = createMcpServer(async () => {
		tokenReads++;
		throw new Error("A static view must not read the caller token");
	});
	const client = new Client({ name: "mcp-app-qa", version: "1" });
	const [c, s] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(s), client.connect(c)]);
	return {
		client,
		tokenReads: () => tokenReads,
		close: async () => {
			await client.close();
			await server.close();
		},
	};
}

test("tools/list exposes the UI _meta only on bound tools, equal to the generated value", async () => {
	const f = await connect();
	try {
		const { tools } = await f.client.listTools();
		expect(tools.map((tool) => tool.name)).toEqual(
			MCP_TOOLS.map((tool) => tool.name),
		);
		let bound = 0;
		for (const generated of MCP_TOOLS) {
			const listed = tools.find((tool) => tool.name === generated.name);
			if ("_meta" in generated) {
				bound++;
				expect(listed?._meta).toEqual(generated._meta);
				const uri = generated._meta.ui.resourceUri;
				expect(generated._meta["openai/outputTemplate"]).toBe(uri);
				expect(MCP_UI_RESOURCES.map((view) => view.uri)).toContain(uri);
			} else expect(listed?._meta).toBeUndefined();
		}
		expect(bound).toBe(MCP_UI_RESOURCES.length);
		expect(bound).toBeGreaterThan(0);
		expect(f.tokenReads()).toBe(0);
	} finally {
		await f.close();
	}
});

test("resources/list and resources/read serve every generated view with the MCP Apps mimeType", async () => {
	const f = await connect();
	try {
		expect(f.client.getServerCapabilities()).toMatchObject({
			tools: {},
			resources: {},
		});
		const { resources } = await f.client.listResources();
		expect(resources).toEqual(
			MCP_UI_RESOURCES.map(({ template: _source, ...resource }) => resource),
		);
		for (const view of MCP_UI_RESOURCES) {
			expect(view.uri.startsWith("ui://")).toBe(true);
			expect(view.mimeType).toBe(MCP_APP_MIME_TYPE);
			const { contents } = await f.client.readResource({ uri: view.uri });
			expect(contents).toEqual([
				{
					uri: view.uri,
					mimeType: "text/html;profile=mcp-app",
					text: readFileSync(
						`src/server/mcp/apps/${view.template}.html`,
						"utf8",
					),
					_meta: view._meta,
				},
			]);
		}
		expect(f.tokenReads()).toBe(0);
	} finally {
		await f.close();
	}
});

test.each([
	"ui://think-wide/missing.html",
	"ui://other-server/investigation-v1.html",
	"file:///etc/passwd",
	"src/server/mcp/apps/investigation.html",
	"../../.env.local",
])("unknown resource %s is the SDK's not-found error", async (uri) => {
	const f = await connect();
	try {
		const failure = await f.client.readResource({ uri }).catch((e) => e);
		expect(failure).toBeInstanceOf(McpError);
		expect(failure.code).toBe(ErrorCode.InvalidParams);
		expect(failure.message).toContain(`Resource ${uri} not found`);
		expect(f.tokenReads()).toBe(0);
		// The SDK's high-level server parses the uri first and answers a path-like string with
		// InternalError "Invalid URL". This adapter answers every unknown string the same way.
		if (!URL.canParse(uri)) {
			return;
		}
		// Byte-for-byte what the SDK's own high-level server answers for an unknown resource.
		const reference = new McpServer({ name: "reference", version: "1" });
		reference.registerResource(
			"known",
			"ui://reference/known",
			{},
			async () => ({
				contents: [],
			}),
		);
		const probe = new Client({ name: "reference-qa", version: "1" });
		const [c, s] = InMemoryTransport.createLinkedPair();
		await Promise.all([reference.connect(s), probe.connect(c)]);
		try {
			const standard = await probe.readResource({ uri }).catch((e) => e);
			expect(standard).toBeInstanceOf(McpError);
			expect({ code: failure.code, message: failure.message }).toEqual({
				code: standard.code,
				message: standard.message,
			});
		} finally {
			await probe.close();
			await reference.close();
		}
	} finally {
		await f.close();
	}
});
