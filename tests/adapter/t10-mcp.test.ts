import { createHash } from "node:crypto";
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
	Handoff,
	HandoffSummary,
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

test("generated MCP tools preserve a correction through revised cross-repository findings and frozen briefs", async () => {
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
	const beta = await openSnapshot({
		repositoryId: "beta",
		bundlePath: bundlePath("beta"),
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
		await a.mutation(internal.snapshots.register, {
			project: {
				repositoryId: "beta",
				displayName: "Synthetic beta",
				provider: "local-git",
				syncStatus: "ready",
				dataLabel: "synthetic",
				snapshots: [beta.summary],
			} satisfies Project,
			entries: beta.entries,
		});
		const betaEntry = beta.entries.find((e) => e.displayPath === "lib/beta.ts");
		if (!betaEntry) throw new Error("Missing beta fixture source");
		const betaSource = {
			snapshotId: beta.summary.snapshotId,
			entryId: betaEntry.entryId,
		};
		await a.mutation(internal.sourceCache.put, {
			...betaSource,
			bytes: Uint8Array.from(await beta.blob(betaEntry.entryId)).buffer,
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
			question: "Compare the alpha and beta marker functions for reuse",
			snapshotIds: [source.snapshotId, betaSource.snapshotId],
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
			byteRange: { start: 0, end: 158 },
		});
		expect(validators.Evidence(read)).toBe(true);
		const evidence = read as Evidence;
		expect(evidence.content).toBe(
			new TextDecoder().decode(await snapshot.blob(entry.entryId)),
		);
		const betaRead = await call("readSource", {
			...betaSource,
			byteRange: { start: 0, end: 145 },
		});
		expect(validators.Evidence(betaRead)).toBe(true);
		const betaEvidence = betaRead as Evidence;
		expect(betaEvidence.content).toBe(
			new TextDecoder().decode(await beta.blob(betaEntry.entryId)),
		);
		const refs = [evidence.ref, betaEvidence.ref];
		for (const value of [evidence, betaEvidence]) {
			expect(value.ref.digest).toBe(
				createHash("sha256").update(value.content, "utf8").digest("hex"),
			);
		}
		// Scripted test claims are not a live model or a human acceptance receipt.
		const initialClaim =
			"Similar marker functions may support a shared helper.";
		const request = {
			proposal: {
				investigationId: investigation.investigationId,
				runId: run.runId,
				baseRevision: 0,
				claims: [
					{
						statement: initialClaim,
						evidenceClass: "model_hypothesis",
						refs,
					},
				],
			},
			requestKey: "mcp-host-submit",
		};
		const published = await call("submitProposal", request);
		expect(published).toMatchObject({
			revision: 0,
			acceptedFindings: [{ verification: "unverified", refs }],
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
		const prepare = {
			investigationId: investigation.investigationId,
			expectedRevision: 0,
			targetRepositoryId: "alpha",
			audience: "private_download",
			requestKey: "mcp-host-brief-before",
		};
		const beforeSummary = await call("prepareHandoff", prepare);
		expect(validators.HandoffSummary(beforeSummary)).toBe(true);
		const before = await call("readHandoff", {
			handoffId: (beforeSummary as HandoffSummary).handoffId,
		});
		expect(validators.Handoff(before)).toBe(true);
		const beforeBrief = before as Handoff;
		expect(beforeBrief.bodyMarkdown).toContain(initialClaim);
		const pending = await call("beginHostRun", {
			...admission,
			requestKey: "mcp-host-pending",
		});
		expect(validators.Run(pending)).toBe(true);
		const pendingRun = pending as Run;
		const correction =
			"Keep alpha and beta independent; similar code is not permission to introduce a shared dependency.";
		const decision = await call("recordDecision", {
			investigationId: investigation.investigationId,
			expectedRevision: 0,
			kind: "correction",
			statement: correction,
			category: "architecture",
			targetFindingId: (published as Investigation).acceptedFindings?.[0]
				.findingId,
			refs,
			requestKey: "mcp-host-correction",
		});
		expect(validators.Decision(decision)).toBe(true);
		expect(
			await call("readInvestigation", {
				investigationId: investigation.investigationId,
			}),
		).toMatchObject({
			revision: 1,
			decisions: [{ statement: correction, category: "architecture" }],
		});
		expect(
			await call("submitProposal", { ...request, requestKey: "mcp-host-late" }),
		).toMatchObject({ code: "revision_conflict", currentRevision: 1 });
		expect(
			await a.query(api.runs.getRun, { request: { runId: run.runId } }),
		).toMatchObject({ status: "published" });
		const beforeLate = await call("readInvestigation", {
			investigationId: investigation.investigationId,
		});
		expect(
			await call("submitProposal", {
				...request,
				proposal: { ...request.proposal, runId: pendingRun.runId },
				requestKey: "mcp-host-pending-late",
			}),
		).toMatchObject({ code: "revision_conflict", currentRevision: 1 });
		expect(await call("getRun", { runId: pendingRun.runId })).toMatchObject({
			status: "superseded",
		});
		expect(
			await call("readInvestigation", {
				investigationId: investigation.investigationId,
			}),
		).toEqual(beforeLate);
		const revised = await call("beginHostRun", {
			...admission,
			expectedRevision: 1,
			requestKey: "mcp-host-revised",
		});
		expect(validators.Run(revised)).toBe(true);
		// Refresh the exact evidence after the new admission fence.
		for (const value of [evidence, betaEvidence]) {
			expect(
				await call("readSource", {
					snapshotId: value.ref.snapshotId,
					entryId: value.ref.entryId,
					byteRange: value.ref.byteRange,
				}),
			).toEqual(value);
		}
		const revisedClaim =
			"Keep the marker implementations independent; compare their behavior without adding a shared dependency.";
		const updated = await call("submitProposal", {
			proposal: {
				...request.proposal,
				runId: (revised as Run).runId,
				baseRevision: 1,
				claims: [
					{ statement: revisedClaim, evidenceClass: "model_hypothesis", refs },
				],
			},
			requestKey: "mcp-host-revised-submit",
		});
		expect(updated).toMatchObject({
			revision: 1,
			decisions: [decision],
			acceptedFindings: [
				{ summary: initialClaim, verification: "unverified" },
				{ summary: revisedClaim, verification: "unverified", refs },
			],
		});
		const afterSummary = await call("prepareHandoff", {
			...prepare,
			expectedRevision: 1,
			requestKey: "mcp-host-brief-after",
		});
		expect(validators.HandoffSummary(afterSummary)).toBe(true);
		const after = await call("readHandoff", {
			handoffId: (afterSummary as HandoffSummary).handoffId,
		});
		expect(validators.Handoff(after)).toBe(true);
		const afterBrief = after as Handoff;
		expect(afterBrief.constraints).toEqual([
			expect.objectContaining({
				statement: correction,
				kind: "correction",
				category: "architecture",
			}),
		]);
		expect(afterBrief.bodyMarkdown).toContain(revisedClaim);
		expect(afterBrief.bodyHash).not.toBe(beforeBrief.bodyHash);
		for (const brief of [beforeBrief, afterBrief]) {
			expect(brief.bodyHash).toBe(
				createHash("sha256").update(brief.bodyMarkdown, "utf8").digest("hex"),
			);
			expect(await call("readHandoff", { handoffId: brief.handoffId })).toEqual(
				brief,
			);
		}
	} finally {
		await client.close();
		await server.close();
		await snapshot.close();
		await beta.close();
	}
});
