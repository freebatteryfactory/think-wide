import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { MCP_TOOL_NAMES, MCP_TOOLS } from "../../generated/mcp-tools";
import type {
	Evidence,
	Investigation,
	Project,
	Run,
} from "../../generated/types";
import * as validators from "../../generated/validators.js";
import { openSnapshot } from "../../src/server/git/snapshot";
import { createMcpServer } from "../../src/server/mcp/server";
import { PRINCIPAL_A } from "../fixtures/identities";
import { bundlePath } from "../fixtures/repos/cases";

const modules = import.meta.glob("../../convex/**/*.ts");
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

test("generated MCP tools run admission, exact reads, publication, replay and correction through real handlers", async () => {
	vi.stubEnv("THINK_WIDE_MODE", "local-demo");
	vi.stubEnv("CONVEX_SELF_HOSTED_URL", "http://127.0.0.1:3210");
	const t = convexTest(schema, modules);
	const a = t.withIdentity({
		issuer: PRINCIPAL_A.issuer,
		subject: PRINCIPAL_A.subject,
		tokenIdentifier: `${PRINCIPAL_A.issuer}|${PRINCIPAL_A.subject}`,
	});
	const principals = new WeakMap<ConvexHttpClient, string>();
	vi.spyOn(ConvexHttpClient.prototype, "setAuth").mockImplementation(function (
		this: ConvexHttpClient,
		token,
	) {
		principals.set(this, token);
	});
	// Only HTTP transport is substituted; all identity/policy/storage handlers run.
	const caller = (client: ConvexHttpClient) =>
		principals.get(client) === "A" ? a : t;
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
	const snapshot = await openSnapshot({
		repositoryId: "alpha",
		bundlePath: bundlePath("alpha"),
	});
	const client = new Client({ name: "t10-acceptance", version: "1" });
	const server = createMcpServer(async () => "A");
	try {
		const project: Project = {
			repositoryId: "alpha",
			displayName: "Synthetic alpha",
			provider: "local-git",
			syncStatus: "ready",
			dataLabel: "synthetic",
			snapshots: [snapshot.summary],
		};
		await a.mutation(internal.snapshots.register, {
			project,
			entries: snapshot.entries,
		});
		const entry = snapshot.entries.find(
			(e) => e.displayPath === "src/alpha.ts",
		);
		if (!entry) throw new Error("Missing fixture source");
		const source = {
			snapshotId: snapshot.summary.snapshotId,
			entryId: entry.entryId,
		};
		await a.mutation(internal.sourceCache.put, {
			...source,
			bytes: Uint8Array.from(await snapshot.blob(entry.entryId)).buffer,
		});
		const [c, s] = InMemoryTransport.createLinkedPair();
		await server.connect(s);
		await client.connect(c);
		const call = async (name: string, args: Record<string, unknown>) =>
			(await client.callTool({ name, arguments: args })).structuredContent;
		expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(
			MCP_TOOL_NAMES,
		);
		expect(MCP_TOOLS.some((tool) => tool.name === "beginHostRun")).toBe(true);
		expect(await call("requestAnalysis", {})).toMatchObject({
			code: "capability_disabled",
		});
		const opened = await call("openInvestigation", {
			question: "Host comparison",
			snapshotIds: [source.snapshotId],
			requestKey: "mcp-host-open",
		});
		expect(validators.Investigation(opened)).toBe(true);
		const investigation = opened as Investigation;
		const admission = {
			investigationId: investigation.investigationId,
			expectedRevision: 0,
			purpose: "Read then reason",
			requestKey: "mcp-host-admit",
		};
		const admitted = await call("beginHostRun", admission);
		expect(validators.Run(admitted)).toBe(true);
		const run = admitted as Run;
		expect(run.driver).toBe("host");
		expect(await call("beginHostRun", admission)).toEqual(run);
		const read = await call("readSource", {
			...source,
			byteRange: { start: 0, end: 60 },
		});
		expect(validators.Evidence(read)).toBe(true);
		const evidence = read as Evidence;
		expect(evidence.content).toBe(
			new TextDecoder().decode(
				(await snapshot.blob(entry.entryId)).subarray(0, 60),
			),
		);
		const request = {
			proposal: {
				investigationId: investigation.investigationId,
				runId: run.runId,
				baseRevision: 0,
				claims: [
					{
						statement: "Host hypothesis",
						evidenceClass: "model_hypothesis",
						refs: [evidence.ref],
					},
				],
			},
			requestKey: "mcp-host-submit",
		};
		const published = await call("submitProposal", request);
		expect(published).toMatchObject({
			revision: 0,
			acceptedFindings: [{ verification: "unverified", refs: [evidence.ref] }],
		});
		expect(await call("submitProposal", request)).toEqual(published);
		expect(
			await call("submitProposal", {
				...request,
				proposal: {
					...request.proposal,
					claims: [{ ...request.proposal.claims[0], statement: "Changed" }],
				},
			}),
		).toMatchObject({ code: "request_key_conflict" });
		expect(
			await call("submitProposal", { ...request, owner: "forged" }),
		).toMatchObject({ code: "invalid_request" });
		await call("recordDecision", {
			investigationId: investigation.investigationId,
			expectedRevision: 0,
			kind: "correction",
			statement: "Preserve caller's correction",
			requestKey: "mcp-host-correction",
		});
		expect(
			await call("readInvestigation", {
				investigationId: investigation.investigationId,
			}),
		).toMatchObject({
			revision: 1,
			decisions: [{ statement: "Preserve caller's correction" }],
		});
		expect(
			await call("submitProposal", { ...request, requestKey: "mcp-host-late" }),
		).toMatchObject({ code: "revision_conflict", currentRevision: 1 });
		expect(
			await a.query(api.runs.getRun, { request: { runId: run.runId } }),
		).toMatchObject({ status: "published" });
	} finally {
		await client.close();
		await server.close();
		await snapshot.close();
	}
});
