import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import schema from "../../convex/schema";
import { OPERATION_LIMITS } from "../../core/limits";
import {
	MCP_APP_MIME_TYPE,
	MCP_TOOL_NAMES,
	MCP_TOOLS,
	MCP_UI_RESOURCES,
} from "../../generated/mcp-tools";
import {
	OPERATIONS,
	UNIMPLEMENTED_OPERATIONS,
} from "../../generated/operations";
import type { Investigation } from "../../generated/types";
import * as validators from "../../generated/validators.js";
import {
	handleMcp,
	handleOperation,
	protectedResourceMetadata,
} from "../../src/server/http";

const requestValidators = { ...validators };
const modules = import.meta.glob("../../convex/**/*.ts");
const resource = "https://think-wide.example/api/mcp";
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let sequence = 0;
let clientId: string;
let issuer: string;
let oauthIssuer: string;
let keyFetch: ReturnType<typeof vi.fn>;

beforeAll(async () => {
	keys = await generateKeyPair("RS256");
});
beforeEach(async () => {
	clientId = `client_http${++sequence}`;
	issuer = `https://api.workos.com/user_management/${clientId}`;
	oauthIssuer = `https://http${sequence}.authkit.app`;
	vi.stubEnv("MCP_AUTHORIZATION_SERVER", oauthIssuer);
	vi.stubEnv("THINK_WIDE_MODE", "connected");
	vi.stubEnv("CONVEX_SELF_HOSTED_URL", "https://convex.example");
	vi.stubEnv("MCP_RESOURCE_URL", resource);
	vi.stubEnv("WORKOS_CLIENT_ID", clientId);
	const jwk = {
		...(await exportJWK(keys.publicKey)),
		kid: "test-key",
		alg: "RS256",
		use: "sig",
	};
	keyFetch = vi.fn(async (url: string | URL | Request) => {
		expect([
			`https://api.workos.com/sso/jwks/${clientId}`,
			`${oauthIssuer}/oauth2/jwks`,
		]).toContain(String(url));
		return Response.json({ keys: [jwk] });
	});
	vi.stubGlobal("fetch", keyFetch);
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

async function jwt(
	subject = "A",
	claims: Record<string, unknown> = {},
	profile: "session" | "mcp" = "session",
) {
	return new SignJWT({
		...(profile === "session" ? { client_id: clientId } : { aud: resource }),
		...claims,
	})
		.setProtectedHeader({ alg: "RS256", kid: "test-key" })
		.setIssuer(profile === "session" ? issuer : oauthIssuer)
		.setSubject(subject)
		.setIssuedAt()
		.setExpirationTime("5m")
		.sign(keys.privateKey);
}
function request(
	token?: string,
	body: unknown = { jsonrpc: "2.0", id: 1, method: "tools/list" },
	extra: HeadersInit = {},
	url = resource,
) {
	return new Request(url, {
		method: "POST",
		headers: {
			Accept: "application/json, text/event-stream",
			"Content-Type": "application/json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...extra,
		},
		body: JSON.stringify(body),
	});
}

async function fixture() {
	const t = convexTest(schema, modules);
	const a = await jwt("A");
	const b = await jwt("B");
	const mcpA = await jwt("A", {}, "mcp");
	const mcpB = await jwt("B", {}, "mcp");
	const tokens = new WeakMap<ConvexHttpClient, string>();
	vi.spyOn(ConvexHttpClient.prototype, "setAuth").mockImplementation(function (
		this: ConvexHttpClient,
		token,
	) {
		tokens.set(this, token);
	});
	const caller = (client: ConvexHttpClient) => {
		const token = tokens.get(client);
		if (token !== a && token !== b && token !== mcpA && token !== mcpB)
			throw new Error("Unexpected forwarded token");
		const subject = token === a || token === mcpA ? "A" : "B";
		const tokenIssuer = token === a || token === b ? issuer : oauthIssuer;
		return t.withIdentity({
			issuer: tokenIssuer,
			subject,
			tokenIdentifier: `${tokenIssuer}|${subject}`,
		});
	};
	// Only the Convex network leg is substituted. JWT signature verification and
	// every Convex registration, grant, receipt and revision check really run.
	vi.spyOn(ConvexHttpClient.prototype, "query").mockImplementation(function (
		this: ConvexHttpClient,
		ref,
		args = {},
	) {
		return caller(this).query(ref as FunctionReference<"query">, args);
	});
	vi.spyOn(ConvexHttpClient.prototype, "mutation").mockImplementation(function (
		this: ConvexHttpClient,
		...[ref, args = {}]: Parameters<ConvexHttpClient["mutation"]>
	) {
		return caller(this).mutation(ref as FunctionReference<"mutation">, args);
	});
	await t.run(async (ctx) => {
		for (const tokenIssuer of [issuer, oauthIssuer])
			for (const subject of ["A", "B"])
				await ctx.db.insert("grants", {
					principal: `${tokenIssuer}|${subject}`,
					resourceKind: "snapshot",
					resourceId: "shared_snapshot",
					role: "reader",
					epoch: 1,
				});
	});
	const http = async (operation: string, body: unknown, token = a) =>
		handleOperation(
			request(
				token,
				body,
				{},
				`https://think-wide.example/api/ops/${operation}`,
			),
			operation,
		);
	const mcp = async (token: string) => {
		const client = new Client({ name: "http-qa", version: "1" });
		const transport = new StreamableHTTPClientTransport(new URL(resource), {
			requestInit: { headers: { Authorization: `Bearer ${token}` } },
			fetch: async (input, init) => handleMcp(new Request(input, init)),
		});
		await client.connect(transport);
		return client;
	};
	return { t, a, b, mcpA, mcpB, http, mcp };
}

test("SDK Streamable HTTP initializes, lists generated inventory, excludes HTTP-only and unimplemented tools", async () => {
	const f = await fixture();
	const client = await f.mcp(f.mcpA);
	try {
		expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(
			MCP_TOOL_NAMES,
		);
		expect(
			(await client.callTool({ name: "requestAnalysis", arguments: {} }))
				.structuredContent,
		).toMatchObject({ code: "capability_disabled" });
		const operation = OPERATIONS.find(
			(op) =>
				UNIMPLEMENTED_OPERATIONS.some((id) => id === op.operationId) &&
				MCP_TOOL_NAMES.some((name) => name === op.operationId) &&
				requestValidators[op.requestType]({}),
		);
		if (!operation) throw new Error("No unimplemented empty request fixture");
		expect(
			(await client.callTool({ name: operation.operationId, arguments: {} }))
				.structuredContent,
		).toMatchObject({ code: "capability_disabled" });
		expect(keyFetch).toHaveBeenCalledTimes(1);
	} finally {
		await client.close();
	}
});

test("Streamable HTTP serves the generated view binding and the static view; resources still need a valid MCP token", async () => {
	const f = await fixture();
	const client = await f.mcp(f.mcpA);
	const other = await f.mcp(f.mcpB);
	try {
		const bound = MCP_TOOLS.filter((tool) => "_meta" in tool);
		expect(bound.length).toBe(MCP_UI_RESOURCES.length);
		const { tools } = await client.listTools();
		for (const tool of tools)
			expect(tool._meta).toEqual(
				bound.find((item) => item.name === tool.name)?._meta,
			);
		expect((await client.listResources()).resources).toEqual(
			MCP_UI_RESOURCES.map(({ template: _source, ...resource }) => resource),
		);
		for (const view of MCP_UI_RESOURCES) {
			const mine = await client.readResource({ uri: view.uri });
			expect(mine.contents).toEqual([
				{
					uri: view.uri,
					mimeType: MCP_APP_MIME_TYPE,
					text: readFileSync(
						`src/server/mcp/apps/${view.template}.html`,
						"utf8",
					),
					_meta: view._meta,
				},
			]);
			// Static and identical for every principal: nothing user-specific is in the view.
			expect(await other.readResource({ uri: view.uri })).toEqual(mine);
			const read = {
				jsonrpc: "2.0",
				id: 7,
				method: "resources/read",
				params: { uri: view.uri },
			};
			for (const token of [undefined, "garbage", f.a]) {
				const denied = await handleMcp(request(token, read));
				expect(denied.status).toBe(401);
				expect(await denied.text()).not.toContain("<!doctype");
			}
			const allowed = await handleMcp(request(f.mcpA, read));
			expect(allowed.status).toBe(200);
			expect(allowed.headers.get("Cache-Control")).toBe("no-store");
		}
		const list = { jsonrpc: "2.0", id: 8, method: "resources/list" };
		expect((await handleMcp(request(undefined, list))).status).toBe(401);
		await expect(
			client.readResource({ uri: "ui://think-wide/missing.html" }),
		).rejects.toMatchObject({ code: ErrorCode.InvalidParams });

		// The bound tool still returns the validated result as structuredContent, and keeps its
		// text content for hosts that render no view.
		const created = (
			await client.callTool({
				name: "openInvestigation",
				arguments: {
					snapshotIds: ["shared_snapshot"],
					question: "Render me",
					requestKey: "http-view-0001",
				},
			})
		).structuredContent as Investigation;
		expect(bound.map((tool) => tool.name)).toContain("readInvestigation");
		const args = { investigationId: created.investigationId };
		const result = await client.callTool({
			name: "readInvestigation",
			arguments: args,
		});
		expect(result.isError).toBe(false);
		expect(validators.Investigation(result.structuredContent)).toBe(true);
		expect(result.structuredContent).toMatchObject({
			question: "Render me",
			status: "open",
			revision: 0,
		});
		expect(result.content).toEqual([
			{ type: "text", text: expect.stringContaining("structuredContent") },
		]);
		const foreign = await other.callTool({
			name: "readInvestigation",
			arguments: args,
		});
		expect(foreign.isError).toBe(true);
		expect(foreign.structuredContent).toEqual({
			code: "not_found",
			message: "Resource not found",
		});
	} finally {
		await client.close();
		await other.close();
	}
});

test.each([
	"http",
	"mcp",
])("%s preserves decisions, receipts, isolation and revocation", async (surface) => {
	const f = await fixture();
	const client = await f.mcp(f.mcpA);
	const other = await f.mcp(f.mcpB);
	const call = async (
		name: string,
		args: Record<string, unknown>,
		foreign = false,
	) =>
		surface === "http"
			? (await f.http(name, args, foreign ? f.b : f.a)).json()
			: (await (foreign ? other : client).callTool({ name, arguments: args }))
					.structuredContent;
	try {
		const open = {
			snapshotIds: ["shared_snapshot"],
			question: "Keep exact evidence",
			requestKey: "http-open-0001",
		};
		const created = await call("openInvestigation", open);
		expect(validators.Investigation(created)).toBe(true);
		const { investigationId } = created as Investigation;
		expect(await call("openInvestigation", open)).toEqual(created);
		expect(
			await call("openInvestigation", { ...open, question: "Changed" }),
		).toMatchObject({ code: "request_key_conflict" });
		const decision = {
			investigationId: investigationId,
			expectedRevision: 0,
			kind: "correction",
			statement: "Preserve human decision",
			requestKey: "http-decision-0001",
		};
		const saved = await call("recordDecision", decision);
		expect(await call("recordDecision", decision)).toEqual(saved);
		expect(
			await call("readInvestigation", {
				investigationId: investigationId,
			}),
		).toMatchObject({ revision: 1, decisions: [saved] });
		const foreign = await call(
			"readInvestigation",
			{ investigationId: investigationId },
			true,
		);
		expect(JSON.stringify(foreign)).toBe(
			JSON.stringify(
				await call("readInvestigation", { investigationId: "missing" }, true),
			),
		);
		expect(await call("recordDecision", decision, true)).toEqual({
			code: "not_found",
			message: "Resource not found",
		});
		await f.t.run(async (ctx) => {
			for (const grant of await ctx.db.query("grants").collect())
				if (
					grant.principal ===
						`${surface === "http" ? issuer : oauthIssuer}|A` &&
					grant.resourceKind === "snapshot"
				)
					await ctx.db.patch(grant._id, { revokedAt: Date.now() });
		});
		expect(await call("openInvestigation", open)).toMatchObject({
			code: "not_found",
		});
		expect(
			await call("readInvestigation", {
				investigationId: investigationId,
			}),
		).toMatchObject({ code: "not_found" });
		expect(
			await f.t.run(
				async (ctx) => (await ctx.db.query("decisions").collect()).length,
			),
		).toBe(1);
	} finally {
		await client.close();
		await other.close();
	}
});

test("same subject under browser and OAuth issuers is not implicitly the same principal", async () => {
	const f = await fixture();
	const client = await f.mcp(f.mcpA);
	try {
		const open = {
			snapshotIds: ["shared_snapshot"],
			question: "No implicit identity linking",
			requestKey: "split-profile-0001",
		};
		const browser = await (await f.http("openInvestigation", open)).json();
		expect(
			(
				await client.callTool({
					name: "readInvestigation",
					arguments: { investigationId: browser.investigationId },
				})
			).structuredContent,
		).toMatchObject({ code: "not_found" });
		const oauth = (
			await client.callTool({ name: "openInvestigation", arguments: open })
		).structuredContent;
		expect(oauth).not.toEqual(browser);
		expect((await f.http("listProjects", {}, f.mcpA)).status).toBe(401);
		expect((await handleMcp(request(f.a))).status).toBe(401);
	} finally {
		await client.close();
	}
});

const invalidProfiles = (["session", "mcp"] as const).flatMap((profile) =>
	[
		"missing",
		"garbage",
		"expired",
		"wrong issuer",
		"wrong signature",
		"none",
		"wrong audience",
		"no exp",
		...(profile === "session" ? ["wrong client"] : []),
	].map((kind) => ({ profile, kind })),
);
test.each(
	invalidProfiles,
)("$profile rejects $kind with 401 and discovery challenge", async ({
	profile,
	kind,
}) => {
	let token: string | undefined;
	const expectedIssuer = profile === "session" ? issuer : oauthIssuer;
	if (kind === "garbage") token = "garbage";
	else if (kind === "none")
		token = `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(JSON.stringify({ iss: expectedIssuer, sub: "A", aud: resource })).toString("base64url")}.`;
	else if (kind !== "missing") {
		const signer = new SignJWT({
			...(profile === "mcp" ? { aud: resource } : {}),
			...(kind === "wrong audience" ? { aud: "https://evil.example" } : {}),
			...(kind === "wrong client" ? { client_id: "client_wrong" } : {}),
		})
			.setProtectedHeader({ alg: "RS256", kid: "test-key" })
			.setIssuer(
				kind === "wrong issuer" ? "https://evil.example" : expectedIssuer,
			)
			.setSubject("A")
			.setIssuedAt();
		if (kind !== "no exp")
			signer.setExpirationTime(
				kind === "expired" ? Math.floor(Date.now() / 1000) - 1 : "5m",
			);
		token = await signer.sign(
			kind === "wrong signature"
				? (await generateKeyPair("RS256")).privateKey
				: keys.privateKey,
		);
	}
	const response =
		profile === "mcp"
			? await handleMcp(request(token))
			: await handleOperation(request(token), "listProjects");
	expect(response.status).toBe(401);
	expect(response.headers.get("WWW-Authenticate")).toBe(
		profile === "mcp"
			? 'Bearer resource_metadata="https://think-wide.example/.well-known/oauth-protected-resource"'
			: 'Bearer realm="think-wide-browser-api"',
	);
	expect(await response.json()).toEqual({
		code: "unauthenticated",
		message: "Authentication required",
	});
});

test("metadata advertises only the configured OAuth issuer and ignores forwarded hosts", () => {
	const response = protectedResourceMetadata(
		new Request(
			"https://think-wide.example/.well-known/oauth-protected-resource",
			{ headers: { "X-Forwarded-Host": "evil.example" } },
		),
	);
	expect(response.status).toBe(200);
	return expect(response.json()).resolves.toEqual({
		resource,
		authorization_servers: [oauthIssuer],
		bearer_methods_supported: ["header"],
	});
});

test.each([
	"https://evil.example/api/mcp",
	resource,
])("refuses hostile origin and host: %s", async (url) => {
	expect(
		(
			await handleMcp(
				request(
					await jwt(),
					undefined,
					{ Origin: "https://evil.example" },
					url,
				),
			)
		).status,
	).toBe(403);
	expect(
		(
			await handleMcp(
				request(await jwt(), undefined, { Host: "evil.example" }, url),
			)
		).status,
	).toBe(403);
});

test.each([
	"local-demo",
	"",
	"unexpected",
])("disabled in %s mode even for loopback", async (mode) => {
	vi.stubEnv("THINK_WIDE_MODE", mode);
	vi.stubEnv("CONVEX_SELF_HOSTED_URL", "http://127.0.0.1:3210");
	for (const url of [resource, "http://127.0.0.1:3000/api/mcp"])
		expect((await handleMcp(request(undefined, {}, {}, url))).status).toBe(503);
	expect(keyFetch).not.toHaveBeenCalled();
});

test.each([
	"actor",
	"owner",
	"principal",
	"token",
])("rejects smuggled %s through both adapters", async (field) => {
	const f = await fixture();
	const client = await f.mcp(f.mcpA);
	try {
		for (const [name, args] of [
			[
				"openInvestigation",
				{
					snapshotIds: ["shared_snapshot"],
					question: "Q",
					requestKey: "http-smuggle-0001",
					[field]: "B",
				},
			],
			[
				"recordDecision",
				{
					investigationId: "id",
					expectedRevision: 0,
					kind: "correction",
					statement: "S",
					requestKey: "http-smuggle-0002",
					refs: [
						{
							repositoryId: "repo",
							snapshotId: "shared_snapshot",
							entryId: "entry",
							commit: "a".repeat(40),
							blobId: "b".repeat(40),
							hashAlgorithm: "sha1",
							byteRange: { start: 0, end: 1 },
							digest: "c".repeat(64),
							[field]: "B",
						},
					],
				},
			],
		] as const) {
			expect(await (await f.http(name, args)).json()).toMatchObject({
				code: "invalid_request",
				details: expect.any(Array),
			});
			expect(
				(await client.callTool({ name, arguments: args })).structuredContent,
			).toMatchObject({ code: "invalid_request" });
		}
	} finally {
		await client.close();
	}
});

test("rejects malformed, oversized, deep and batch bodies and unsupported methods", async () => {
	const token = await jwt("A", {}, "mcp");
	let deep: object = {};
	for (let i = 0; i < 40; i++) deep = { child: deep };
	for (const body of [
		{ x: "a".repeat(OPERATION_LIMITS.requestBytes) },
		deep,
		[],
	])
		expect((await handleMcp(request(token, body))).status).toBe(400);
	const malformed = new Request(resource, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: "{",
	});
	expect((await handleMcp(malformed)).status).toBe(400);
	for (const method of ["GET", "DELETE", "PUT"])
		expect(
			(
				await handleMcp(
					new Request(resource, {
						method,
						headers: { Authorization: `Bearer ${token}` },
					}),
				)
			).status,
		).toBe(405);
});

test("private HTTP behind TLS proxy uses configured authority and HTTPS discovery", async () => {
	const r = request(
		undefined,
		{},
		{ Host: "think-wide.example", "X-Forwarded-Proto": "https" },
		"http://think-wide.example/api/mcp",
	);
	const response = await handleMcp(r);
	expect(response.status).toBe(401);
	expect(response.headers.get("WWW-Authenticate")).toContain(
		"https://think-wide.example/.well-known/oauth-protected-resource",
	);
});

test.each([
	"absent",
	"wrong",
	"client-id",
])("MCP rejects %s audience from its otherwise valid OAuth issuer", async (kind) => {
	const claims =
		kind === "absent"
			? {}
			: { aud: kind === "wrong" ? "https://other.example/api/mcp" : clientId };
	const token = await new SignJWT(claims)
		.setProtectedHeader({ alg: "RS256", kid: "test-key" })
		.setIssuer(oauthIssuer)
		.setSubject("A")
		.setIssuedAt()
		.setExpirationTime("5m")
		.sign(keys.privateKey);
	expect((await handleMcp(request(token))).status).toBe(401);
});

test("MCP fails closed when OAuth issuer is unconfigured; browser profile still works", async () => {
	const f = await fixture();
	vi.stubEnv("MCP_AUTHORIZATION_SERVER", "");
	expect((await handleMcp(request(f.a))).status).toBe(503);
	expect(
		protectedResourceMetadata(
			new Request(
				"https://think-wide.example/.well-known/oauth-protected-resource",
			),
		).status,
	).toBe(503);
	expect((await f.http("listProjects", {})).status).toBe(200);
});
