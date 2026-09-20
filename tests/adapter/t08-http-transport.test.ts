import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import schema from "../../convex/schema";
import { OPERATION_LIMITS } from "../../core/limits";
import { MCP_TOOL_NAMES } from "../../generated/mcp-tools";
import {
	OPERATIONS,
	UNIMPLEMENTED_OPERATIONS,
} from "../../generated/operations";
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
let keyFetch: ReturnType<typeof vi.fn>;

beforeAll(async () => {
	keys = await generateKeyPair("RS256");
});
beforeEach(async () => {
	clientId = `client_http${++sequence}`;
	issuer = `https://api.workos.com/user_management/${clientId}`;
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
		expect(String(url)).toBe(`https://api.workos.com/sso/jwks/${clientId}`);
		return Response.json({ keys: [jwk] });
	});
	vi.stubGlobal("fetch", keyFetch);
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

async function jwt(subject = "A", claims: Record<string, unknown> = {}) {
	return new SignJWT({ client_id: clientId, ...claims })
		.setProtectedHeader({ alg: "RS256", kid: "test-key" })
		.setIssuer(issuer)
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
	const tokens = new WeakMap<ConvexHttpClient, string>();
	vi.spyOn(ConvexHttpClient.prototype, "setAuth").mockImplementation(function (
		this: ConvexHttpClient,
		token,
	) {
		tokens.set(this, token);
	});
	const caller = (client: ConvexHttpClient) => {
		const token = tokens.get(client);
		if (token !== a && token !== b)
			throw new Error("Unexpected forwarded token");
		const subject = token === a ? "A" : "B";
		return t.withIdentity({
			issuer,
			subject,
			tokenIdentifier: `${issuer}|${subject}`,
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
		for (const subject of ["A", "B"])
			await ctx.db.insert("grants", {
				principal: `${issuer}|${subject}`,
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
	return { t, a, b, http, mcp };
}

test("SDK Streamable HTTP initializes, lists generated inventory, excludes HTTP-only and unimplemented tools", async () => {
	const f = await fixture();
	const client = await f.mcp(f.a);
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

test("HTTP and MCP preserve decisions, receipts, foreign-id indistinguishability and revocation", async () => {
	const f = await fixture();
	const client = await f.mcp(f.a);
	const other = await f.mcp(f.b);
	try {
		const open = {
			snapshotIds: ["shared_snapshot"],
			question: "Keep exact evidence",
			requestKey: "http-open-0001",
		};
		const created = await (await f.http("openInvestigation", open)).json();
		expect(
			(await client.callTool({ name: "openInvestigation", arguments: open }))
				.structuredContent,
		).toEqual(created);
		expect(
			await (
				await f.http("openInvestigation", { ...open, question: "Changed" })
			).json(),
		).toMatchObject({ code: "request_key_conflict" });
		const decision = {
			investigationId: created.investigationId,
			expectedRevision: 0,
			kind: "correction",
			statement: "Preserve human decision",
			requestKey: "http-decision-0001",
		};
		const saved = (
			await client.callTool({ name: "recordDecision", arguments: decision })
		).structuredContent;
		expect(await (await f.http("recordDecision", decision)).json()).toEqual(
			saved,
		);
		expect(
			await (
				await f.http("readInvestigation", {
					investigationId: created.investigationId,
				})
			).json(),
		).toMatchObject({ revision: 1, decisions: [saved] });
		const foreign = await f.http(
			"readInvestigation",
			{ investigationId: created.investigationId },
			f.b,
		);
		const missing = await f.http(
			"readInvestigation",
			{ investigationId: "missing" },
			f.b,
		);
		expect(foreign.status).toBe(404);
		expect(await foreign.text()).toBe(await missing.text());
		expect(
			(await other.callTool({ name: "recordDecision", arguments: decision }))
				.structuredContent,
		).toEqual({ code: "not_found", message: "Resource not found" });
		await tRevoke(f.t);
		expect(
			(await client.callTool({ name: "openInvestigation", arguments: open }))
				.structuredContent,
		).toMatchObject({ code: "not_found" });
		expect(
			await (
				await f.http("readInvestigation", {
					investigationId: created.investigationId,
				})
			).json(),
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
async function tRevoke(t: Awaited<ReturnType<typeof fixture>>["t"]) {
	await t.run(async (ctx) => {
		for (const grant of await ctx.db.query("grants").collect())
			if (
				grant.principal === `${issuer}|A` &&
				grant.resourceKind === "snapshot"
			)
				await ctx.db.patch(grant._id, { revokedAt: Date.now() });
	});
}

test.each([
	"missing",
	"garbage",
	"expired",
	"wrong issuer",
	"wrong signature",
	"none",
	"wrong audience",
	"wrong client",
	"no exp",
])("rejects %s with 401 and discovery challenge before any handler", async (kind) => {
	let token: string | undefined;
	if (kind === "garbage") token = "garbage";
	else if (kind === "none")
		token = `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(JSON.stringify({ iss: issuer, sub: "A" })).toString("base64url")}.`;
	else if (kind !== "missing") {
		const signer = new SignJWT({
			...(kind === "wrong audience" ? { aud: "https://evil.example" } : {}),
			...(kind === "wrong client" ? { client_id: "client_wrong" } : {}),
		})
			.setProtectedHeader({ alg: "RS256", kid: "test-key" })
			.setIssuer(kind === "wrong issuer" ? "https://evil.example" : issuer)
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
	for (const handle of [
		(r: Request) => handleMcp(r),
		(r: Request) => handleOperation(r, "listProjects"),
	]) {
		const response = await handle(request(token));
		expect(response.status).toBe(401);
		expect(response.headers.get("WWW-Authenticate")).toBe(
			'Bearer resource_metadata="https://think-wide.example/.well-known/oauth-protected-resource"',
		);
		expect(await response.json()).toEqual({
			code: "unauthenticated",
			message: "Authentication required",
		});
	}
});

test("metadata is configured, ignores forwarded hosts, and claims no unproven OAuth server", () => {
	const response = protectedResourceMetadata(
		new Request(
			"https://think-wide.example/.well-known/oauth-protected-resource",
			{ headers: { "X-Forwarded-Host": "evil.example" } },
		),
	);
	expect(response.status).toBe(200);
	return expect(response.json()).resolves.toEqual({
		resource,
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
	const client = await f.mcp(f.a);
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
	const token = await jwt();
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
