import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { MCP_TOOL_NAMES } from "../../generated/mcp-tools";
import {
	OPERATIONS,
	UNIMPLEMENTED_OPERATIONS,
} from "../../generated/operations";
import * as validators from "../../generated/validators.js";
import { createMcpServer } from "../../src/server/mcp/server";
import { dispatch } from "../../src/server/ops/dispatch";
import { PRINCIPAL_A, PRINCIPAL_B } from "../fixtures/identities";

const requestValidators = { ...validators };
const modules = import.meta.glob("../../convex/**/*.ts");
const identity = (p: typeof PRINCIPAL_A | typeof PRINCIPAL_B) => ({
	issuer: p.issuer,
	subject: p.subject,
	tokenIdentifier: `${p.issuer}|${p.subject}`,
});

// Substitute only the HTTP transport. Every request runs the actual generated
// Convex registration, validators, identity lookup, grants, receipts and database.
async function fixture() {
	const t = convexTest(schema, modules);
	const principals = new WeakMap<ConvexHttpClient, string>();
	vi.spyOn(ConvexHttpClient.prototype, "setAuth").mockImplementation(function (
		this: ConvexHttpClient,
		token,
	) {
		principals.set(this, token);
	});
	const caller = (client: ConvexHttpClient) => {
		const token = principals.get(client);
		return token === "A"
			? t.withIdentity(identity(PRINCIPAL_A))
			: token === "B"
				? t.withIdentity(identity(PRINCIPAL_B))
				: t;
	};
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
		for (const p of [PRINCIPAL_A, PRINCIPAL_B]) {
			await ctx.db.insert("grants", {
				principal: identity(p).tokenIdentifier,
				resourceKind: "snapshot",
				resourceId: "shared_snapshot",
				role: "reader",
				epoch: 1,
			});
		}
	});
	const client = new Client({ name: "q14", version: "1" });
	const server = createMcpServer(async () => "B");
	const [c, s] = InMemoryTransport.createLinkedPair();
	await server.connect(s);
	await client.connect(c);
	const call = async (name: string, args: Record<string, unknown>) =>
		(await client.callTool({ name, arguments: args })).structuredContent;
	return { t, client, server, call };
}

beforeEach(() => {
	vi.stubEnv("THINK_WIDE_MODE", "local-demo");
	vi.stubEnv("CONVEX_SELF_HOSTED_URL", "http://127.0.0.1:3210");
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

describe("Q14: MCP and dispatch use real operation handlers", () => {
	test("tool inventory, exclusion, disabled operations and capabilities", async () => {
		const { client, server, call } = await fixture();
		try {
			expect((await client.listTools()).tools.map((t) => t.name)).toEqual(
				MCP_TOOL_NAMES,
			);
			expect(await call("requestAnalysis", {})).toMatchObject({
				code: "capability_disabled",
			});
			// Select an unbound exposed operation whose generated schema accepts {}.
			const operation = OPERATIONS.find(
				(op) =>
					UNIMPLEMENTED_OPERATIONS.some((id) => id === op.operationId) &&
					MCP_TOOL_NAMES.some((id) => id === op.operationId) &&
					requestValidators[op.requestType]({}),
			);
			if (!operation)
				throw new Error(
					"Add a valid generated request fixture for an unimplemented MCP operation",
				);
			const disabled = await client.callTool({
				name: operation.operationId,
				arguments: {},
			});
			expect(disabled.isError).toBe(true);
			expect(disabled.structuredContent).toMatchObject({
				code: "capability_disabled",
			});
			expect(
				await client.callTool({ name: "getCapabilities", arguments: {} }),
			).toMatchObject({ isError: false });
			expect(await call("getCapabilities", {})).toMatchObject({
				searchModes: [],
				integrations: { remoteMcp: "not_run", hostedIdentity: "not_run" },
			});
		} finally {
			await client.close();
			await server.close();
		}
	});
	test("decisions, replay, conflicts, isolation and revocation", async () => {
		const { t, client, server, call } = await fixture();
		try {
			const open = {
				snapshotIds: ["shared_snapshot"],
				question: "Keep evidence exact",
				requestKey: "adapter-open-0001",
			};
			const a = await t
				.withIdentity(identity(PRINCIPAL_A))
				.mutation(api.investigations.openInvestigation, { request: open });
			const b = await call("openInvestigation", open);
			expect(b).toHaveProperty("investigationId");
			if (
				!b ||
				typeof b !== "object" ||
				!("investigationId" in b) ||
				typeof b.investigationId !== "string"
			) {
				throw new Error("Missing investigation");
			}
			expect(await call("openInvestigation", open)).toEqual(b);
			expect(
				await call("openInvestigation", { ...open, question: "Changed" }),
			).toMatchObject({ code: "request_key_conflict" });
			const decision = {
				investigationId: b.investigationId,
				expectedRevision: 0,
				kind: "correction",
				statement: "Human correction",
				requestKey: "adapter-decision-0001",
			};
			const d = await call("recordDecision", decision);
			expect(await call("recordDecision", decision)).toEqual(d);
			expect(
				await call("readInvestigation", { investigationId: b.investigationId }),
			).toMatchObject({ revision: 1, decisions: [d] });
			const foreign = await call("readInvestigation", {
				investigationId: a.investigationId,
			});
			const missing = await call("readInvestigation", {
				investigationId: "missing",
			});
			expect(foreign).toEqual({
				code: "not_found",
				message: "Resource not found",
			});
			expect(JSON.stringify(foreign)).toBe(JSON.stringify(missing));
			expect(
				await dispatch(
					"readInvestigation",
					{ investigationId: a.investigationId },
					"B",
				),
			).toEqual(foreign);
			expect(
				await call("recordDecision", {
					...decision,
					investigationId: a.investigationId,
				}),
			).toEqual(foreign);
			await t.run(async (ctx) => {
				const grants = await ctx.db.query("grants").collect();
				for (const grant of grants) {
					if (
						grant.principal === identity(PRINCIPAL_B).tokenIdentifier &&
						grant.resourceKind === "snapshot"
					) {
						await ctx.db.patch(grant._id, { revokedAt: Date.now() });
					}
				}
			});
			expect(
				await call("readInvestigation", { investigationId: b.investigationId }),
			).toEqual(foreign);
			expect(await call("openInvestigation", open)).toEqual(foreign);
			expect(
				(
					await t
						.withIdentity(identity(PRINCIPAL_A))
						.query(api.investigations.readInvestigation, {
							request: { investigationId: a.investigationId },
						})
				).revision,
			).toBe(0);
		} finally {
			await client.close();
			await server.close();
		}
	});
	test.each([
		"actor",
		"owner",
		"principal",
		"token",
	])("rejects %s at top level and in refs", async (field) => {
		const { client, server, call } = await fixture();
		try {
			expect(
				await call("openInvestigation", {
					snapshotIds: ["shared_snapshot"],
					question: "Q",
					requestKey: "smuggle-0001",
					[field]: "A",
				}),
			).toMatchObject({ code: "invalid_request", details: expect.any(Array) });
			expect(
				await call("recordDecision", {
					investigationId: "id",
					kind: "correction",
					statement: "S",
					requestKey: "smuggle-0002",
					expectedRevision: 0,
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
							[field]: "A",
						},
					],
				}),
			).toMatchObject({ code: "invalid_request" });
		} finally {
			await client.close();
			await server.close();
		}
	});
	test("bounds malformed, oversized and deep inputs before handlers", async () => {
		const { client, server, call } = await fixture();
		try {
			for (const request of [
				{},
				{ question: "x".repeat(140000) },
				{ nested: Array.from({ length: 1 }, () => null) },
			]) {
				expect(await call("openInvestigation", request)).toMatchObject({
					code: "invalid_request",
				});
			}
			let deep: Record<string, unknown> = {};
			for (let i = 0; i < 40; i++) {
				deep = { child: deep };
			}
			expect(await call("openInvestigation", deep)).toMatchObject({
				code: "invalid_request",
			});
		} finally {
			await client.close();
			await server.close();
		}
	});
});
