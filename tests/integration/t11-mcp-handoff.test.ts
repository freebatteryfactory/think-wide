import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { internal } from "../../convex/_generated/api";
import { validate, validateResponse } from "../../convex/lib/validation";
import schema from "../../convex/schema";
import type {
	OperationId,
	OperationRequestMap,
	OperationResponseMap,
} from "../../generated/operations";
import type { Project, SnapshotEntry } from "../../generated/types";
import {
	SnapshotEntry as validEntry,
	Project as validProject,
} from "../../generated/validators.js";
import { readHandoffExport } from "../../src/components/behavior/handoff-export";
import { type GitSnapshot, openSnapshot } from "../../src/server/git/snapshot";
import { createMcpServer } from "../../src/server/mcp/server";
import { bundlePath, FIXTURE_FILES } from "../fixtures/repos/cases";

// Only HTTP transport is substituted. MCP SDK, generated dispatch, validators,
// authorization, transactions, receipts and export reassembly are real. Fixture
// identity is NOT evidence of JWT verification, a live host, or a browser login.
const modules = import.meta.glob("../../convex/**/*.ts");
const identities = {
	A: { issuer: "t11-mcp", subject: "A", tokenIdentifier: "t11-mcp|A" },
	B: { issuer: "t11-mcp", subject: "B", tokenIdentifier: "t11-mcp|B" },
};
const snapshots: GitSnapshot[] = [];
const correction =
	"Keep alpha and beta marker implementations separate; shared shape does not prove shared behavior.";
const acceptance = "Café 東京 🧪\r\n".repeat(650);

beforeAll(async () => {
	for (const repositoryId of ["alpha", "beta"] as const) {
		snapshots.push(
			await openSnapshot({
				repositoryId,
				bundlePath: bundlePath(repositoryId),
			}),
		);
	}
});
afterAll(async () => {
	for (const snapshot of snapshots) {
		await snapshot.close();
	}
});
beforeEach(() => {
	vi.stubEnv("THINK_WIDE_MODE", "local-demo");
	vi.stubEnv("CONVEX_SELF_HOSTED_URL", "http://127.0.0.1:3210");
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

async function invoke<K extends OperationId>(
	client: Client,
	name: K,
	request: OperationRequestMap[K],
): Promise<OperationResponseMap[K]> {
	const reply = await client.callTool({ name, arguments: { ...request } });
	if (reply.isError) {
		throw new Error(
			`MCP rejected ${name}: ${JSON.stringify(reply.structuredContent)}`,
		);
	}
	validateResponse(name, reply.structuredContent);
	return reply.structuredContent as OperationResponseMap[K];
}

async function fixture() {
	const t = convexTest(schema, modules);
	const tokens = new WeakMap<ConvexHttpClient, string>();
	vi.spyOn(ConvexHttpClient.prototype, "setAuth").mockImplementation(function (
		this: ConvexHttpClient,
		token,
	) {
		tokens.set(this, token);
	});
	const caller = (client: ConvexHttpClient) => {
		const token = tokens.get(client);
		return token === "A" || token === "B"
			? t.withIdentity(identities[token])
			: t;
	};
	vi.spyOn(ConvexHttpClient.prototype, "query").mockImplementation(function (
		this: ConvexHttpClient,
		reference,
		args = {},
	) {
		return caller(this).query(reference as FunctionReference<"query">, args);
	});
	vi.spyOn(ConvexHttpClient.prototype, "mutation").mockImplementation(function (
		this: ConvexHttpClient,
		...[reference, args = {}]: Parameters<ConvexHttpClient["mutation"]>
	) {
		return caller(this).mutation(
			reference as FunctionReference<"mutation">,
			args,
		);
	});
	for (const snapshot of snapshots) {
		const owner = t.withIdentity(
			snapshot.repositoryId === "alpha" ? identities.A : identities.B,
		);
		const project: Project = {
			repositoryId: snapshot.repositoryId,
			displayName: `Synthetic ${snapshot.repositoryId}`,
			provider: "local-git",
			syncStatus: "ready",
			dataLabel: "synthetic",
			snapshots: [snapshot.summary],
		};
		await owner.mutation(internal.snapshots.register, {
			project,
			entries: snapshot.entries,
		});
		const path =
			snapshot.repositoryId === "alpha" ? "src/alpha.ts" : "lib/beta.ts";
		const entry = snapshot.entries.find(
			(candidate) => candidate.displayPath === path,
		);
		if (!entry) {
			throw new Error("Missing independent fixture source");
		}
		await owner.mutation(internal.sourceCache.put, {
			snapshotId: snapshot.summary.snapshotId,
			entryId: entry.entryId,
			bytes: Uint8Array.from(await snapshot.blob(entry.entryId)).buffer,
		});
	}
	await t.run((ctx) =>
		ctx.db.insert("grants", {
			principal: identities.A.tokenIdentifier,
			resourceKind: "snapshot",
			resourceId: snapshots[1].summary.snapshotId,
			role: "reader",
			epoch: 1,
		}),
	);
	const connections: Array<{
		client: Client;
		server: ReturnType<typeof createMcpServer>;
	}> = [];
	const connect = async (principal: "A" | "B") => {
		const client = new Client({
			name: "t11-prerequisite-integration",
			version: "1",
		});
		const server = createMcpServer(async () => principal);
		connections.push({ client, server });
		const [clientTransport, serverTransport] =
			InMemoryTransport.createLinkedPair();
		await server.connect(serverTransport);
		await client.connect(clientTransport);
		return client;
	};
	const close = async () => {
		for (const connection of connections) {
			await connection.client.close();
			await connection.server.close();
		}
	};
	return { t, connect, close };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function businessState(t: Fixture["t"]) {
	return t.run(async (ctx) => ({
		investigations: await ctx.db.query("investigations").collect(),
		decisions: await ctx.db.query("decisions").collect(),
		handoffs: await ctx.db.query("handoffs").collect(),
		receipts: await ctx.db.query("receipts").collect(),
		runs: await ctx.db.query("runs").collect(),
		jobs: await ctx.db.system.query("_scheduled_functions").collect(),
	}));
}

async function readMarker(client: Client, snapshot: GitSnapshot) {
	const root = await invoke(client, "browseSnapshot", {
		snapshotId: snapshot.summary.snapshotId,
	});
	const directory = root.entries
		.map((entry) => validate<SnapshotEntry>(validEntry, entry, true))
		.find(
			(entry) =>
				entry.kind === "tree" &&
				entry.name === (snapshot.repositoryId === "alpha" ? "src" : "lib"),
		);
	if (!directory || typeof directory.entryId !== "string") {
		throw new Error("Missing directory in MCP tree");
	}
	const children = await invoke(client, "browseSnapshot", {
		snapshotId: snapshot.summary.snapshotId,
		parentEntryId: directory.entryId,
	});
	const file = children.entries
		.map((entry) => validate<SnapshotEntry>(validEntry, entry, true))
		.find((entry) => entry.name === `${snapshot.repositoryId}.ts`);
	if (!file || typeof file.entryId !== "string") {
		throw new Error("Missing marker in MCP tree");
	}
	const evidence = await invoke(client, "readSource", {
		snapshotId: snapshot.summary.snapshotId,
		entryId: file.entryId,
	});
	const expected = FIXTURE_FILES.find(
		(fixture) =>
			fixture.repo === snapshot.repositoryId &&
			fixture.path.endsWith(`${snapshot.repositoryId}.ts`),
	);
	if (!expected) {
		throw new Error("Missing independent byte oracle");
	}
	expect(evidence.content).toBe(expected.content);
	expect(`sha256:${evidence.ref.digest}`).toBe(expected.sha256);
	expect(evidence.ref).toMatchObject({
		repositoryId: snapshot.repositoryId,
		snapshotId: snapshot.summary.snapshotId,
		commit: snapshot.summary.commit,
		hashAlgorithm: snapshot.summary.hashAlgorithm,
		blobId: snapshot.entry(file.entryId).objectId,
		entryId: file.entryId,
		byteRange: { start: 0, end: expected.byteLength },
	});
	return evidence.ref;
}

async function prepareComparison(client: Client) {
	const alpha = await readMarker(client, snapshots[0]);
	const beta = await readMarker(client, snapshots[1]);
	const investigation = await invoke(client, "openInvestigation", {
		question:
			"Compare alpha and beta marker implementations using exact source evidence.",
		snapshotIds: [
			snapshots[0].summary.snapshotId,
			snapshots[1].summary.snapshotId,
		],
		requestKey: "t11-mcp-open",
	});
	const request = {
		investigationId: investigation.investigationId,
		expectedRevision: 0,
		kind: "correction" as const,
		category: "architecture" as const,
		statement: correction,
		refs: [alpha, beta] as [typeof alpha, typeof beta],
		requestKey: "t11-mcp-correction",
	};
	const decision = await invoke(client, "recordDecision", request);
	expect(await invoke(client, "recordDecision", request)).toEqual(decision);
	await invoke(client, "recordDecision", {
		investigationId: investigation.investigationId,
		expectedRevision: 1,
		kind: "acceptance",
		statement: acceptance,
		requestKey: "t11-mcp-acceptance",
	});
	const prepare = {
		investigationId: investigation.investigationId,
		expectedRevision: 2,
		targetRepositoryId: "alpha",
		audience: "private_download" as const,
		requestKey: "t11-mcp-prepare",
	};
	const saved = await invoke(client, "prepareHandoff", prepare);
	return { investigation, decision, prepare, saved, refs: [alpha, beta] };
}

describe("T11 after T09: real-source MCP to protected saved brief (transport substituted)", () => {
	it("Q04/Q07: reopens and exports a multi-window brief from MCP with immutable replay and a complete decision ledger", async () => {
		const f = await fixture();
		try {
			const client = await f.connect("A");
			const projects = await invoke(client, "listProjects", {});
			expect(
				projects.entries
					.map(
						(project) =>
							validate<Project>(validProject, project, true).repositoryId,
					)
					.sort(),
			).toEqual(["alpha", "beta"]);
			const { investigation, decision, prepare, saved } =
				await prepareComparison(client);
			expect(saved.bodyByteLength).toBeGreaterThan(16384);
			const reopened = await f.connect("A");
			const view = await invoke(reopened, "readInvestigation", {
				investigationId: investigation.investigationId,
			});
			expect(view.revision).toBe(2);
			expect(view.decisions?.[0]).toEqual(decision);
			const decisions = [...(view.decisions ?? [])];
			let cursor = view.page?.nextCursor;
			let pages = 1;
			while (cursor) {
				if (++pages > 4) {
					throw new Error("Decision pagination did not terminate");
				}
				const page = await invoke(reopened, "readInvestigation", {
					investigationId: investigation.investigationId,
					cursor,
				});
				expect(page.revision).toBe(2);
				decisions.push(...(page.decisions ?? []));
				cursor = page.page?.nextCursor;
			}
			expect(decisions).toHaveLength(2);
			expect(decisions[1]).toMatchObject({
				kind: "acceptance",
				statement: acceptance,
			});

			let windows = 0;
			const exported = await readHandoffExport(saved, async (request) => {
				const response = await invoke(reopened, "readHandoff", request);
				if ("content" in response) {
					windows++;
				}
				expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThanOrEqual(
					16384,
				);
				return response;
			});
			expect(windows).toBeGreaterThan(1);
			expect(Buffer.byteLength(exported.bodyMarkdown)).toBe(
				saved.bodyByteLength,
			);
			expect(
				createHash("sha256").update(exported.bodyMarkdown).digest("hex"),
			).toBe(saved.bodyHash);
			expect(exported.bodyMarkdown).toContain(correction);
			expect(exported.bodyMarkdown).toContain(JSON.stringify(acceptance));
			for (const snapshot of snapshots) {
				expect(exported.bodyMarkdown).toContain(snapshot.summary.commit);
			}
			await invoke(client, "recordDecision", {
				investigationId: investigation.investigationId,
				expectedRevision: 2,
				kind: "constraint",
				statement: "This newer decision must not mutate the saved brief.",
				requestKey: "t11-mcp-later-decision",
			});
			expect(await invoke(reopened, "prepareHandoff", prepare)).toEqual(saved);
			expect(
				await readHandoffExport(saved, (request) =>
					invoke(reopened, "readHandoff", request),
				),
			).toEqual(exported);
			const before = await businessState(f.t);
			await expect(
				invoke(client, "prepareHandoff", {
					...prepare,
					targetRepositoryId: "beta",
				}),
			).rejects.toThrow("request_key_conflict");
			await expect(
				invoke(client, "prepareHandoff", {
					...prepare,
					requestKey: "t11-mcp-stale-new-key",
				}),
			).rejects.toThrow("revision_conflict");
			expect(await businessState(f.t)).toEqual(before);
			expect(before.handoffs).toHaveLength(1);
			expect(before.decisions).toHaveLength(3);
			expect(before.jobs).toEqual([]);
		} finally {
			await f.close();
		}
	});

	it("Q01/Q09: allows B's own brief, hides A's brief, and stops export/replay after a consumed snapshot is revoked", async () => {
		const f = await fixture();
		try {
			const a = await f.connect("A");
			const b = await f.connect("B");
			const { saved, prepare } = await prepareComparison(a);
			const beta = await readMarker(b, snapshots[1]);
			const own = await invoke(b, "openInvestigation", {
				question: "B's beta-only control",
				snapshotIds: [snapshots[1].summary.snapshotId],
				requestKey: "t11-mcp-b-open",
			});
			await invoke(b, "recordDecision", {
				investigationId: own.investigationId,
				expectedRevision: 0,
				kind: "constraint",
				statement: "Keep the beta marker.",
				refs: [beta],
				requestKey: "t11-mcp-b-decision",
			});
			const ownBrief = await invoke(b, "prepareHandoff", {
				investigationId: own.investigationId,
				expectedRevision: 1,
				targetRepositoryId: "beta",
				audience: "private_download",
				requestKey: "t11-mcp-b-brief",
			});
			expect(
				(
					await readHandoffExport(ownBrief, (request) =>
						invoke(b, "readHandoff", request),
					)
				).bodyHash,
			).toBe(ownBrief.bodyHash);
			const before = await businessState(f.t);
			for (const handoffId of [saved.handoffId, "missing-brief"]) {
				const denied = await b.callTool({
					name: "readHandoff",
					arguments: { handoffId, detail: "summary" },
				});
				expect(denied.isError).toBe(true);
				expect(denied.structuredContent).toEqual({
					code: "not_found",
					message: "Resource not found",
				});
			}
			let receivedWindows = 0;
			await expect(
				readHandoffExport(saved, async (request) => {
					const response = await invoke(a, "readHandoff", request);
					if (request.detail === "body") {
						receivedWindows++;
						if (receivedWindows === 1) {
							await f.t.run(async (ctx) => {
								const grant = await ctx.db
									.query("grants")
									.withIndex("by_principal_resource", (q) =>
										q
											.eq("principal", identities.A.tokenIdentifier)
											.eq("resourceKind", "snapshot")
											.eq("resourceId", snapshots[1].summary.snapshotId),
									)
									.unique();
								if (!grant) {
									throw new Error("Missing consumed-source grant");
								}
								await ctx.db.patch(grant._id, { revokedAt: Date.now() });
							});
						}
					}
					return response;
				}),
			).rejects.toThrow("not_found");
			expect(receivedWindows).toBe(1);
			await expect(invoke(a, "prepareHandoff", prepare)).rejects.toThrow(
				"not_found",
			);
			await expect(
				invoke(a, "readHandoff", {
					handoffId: saved.handoffId,
					detail: "summary",
				}),
			).rejects.toThrow("not_found");
			// A's target source and B's own consumed source still work: no blanket denial.
			await readMarker(a, snapshots[0]);
			await readMarker(b, snapshots[1]);
			expect(await businessState(f.t)).toEqual(before);
		} finally {
			await f.close();
		}
	});
});
