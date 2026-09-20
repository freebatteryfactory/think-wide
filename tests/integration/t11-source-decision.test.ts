// @vitest-environment edge-runtime

import { createHash } from "node:crypto";
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import type { Project } from "../../generated/types";
import { type GitSnapshot, openSnapshot } from "../../src/server/git/snapshot";
import {
	bundlePath,
	FIXTURE_FILES,
	readManifest,
} from "../fixtures/repos/cases";

// T11 prerequisite integration, not Q15 completion: real Git + Convex handlers,
// fixture identities and a deterministic late proposal; no browser/JWT/model/brief.
const modules = import.meta.glob("../../convex/**/*.ts");
const identityA = { issuer: "t11", subject: "A", tokenIdentifier: "t11|A" };
const identityB = { issuer: "t11", subject: "B", tokenIdentifier: "t11|B" };
let alpha: GitSnapshot;
let beta: GitSnapshot;

beforeAll(async () => {
	alpha = await openSnapshot({
		repositoryId: "alpha",
		bundlePath: bundlePath("alpha"),
	});
	beta = await openSnapshot({
		repositoryId: "beta",
		bundlePath: bundlePath("beta"),
	});
});
afterAll(async () => {
	await alpha?.close();
	await beta?.close();
});

async function fixture() {
	const t = convexTest(schema, modules);
	const a = t.withIdentity(identityA);
	const b = t.withIdentity(identityB);
	for (const [snapshot, owner] of [
		[alpha, a],
		[beta, b],
	] as const) {
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
		for (const file of FIXTURE_FILES.filter(
			(file) => file.repo === snapshot.repositoryId,
		)) {
			const entry = snapshot.entries.find(
				(entry) => entry.displayPath === file.path,
			);
			if (!entry) throw new Error("Missing independent source fixture");
			await owner.mutation(internal.sourceCache.put, {
				snapshotId: snapshot.summary.snapshotId,
				entryId: entry.entryId,
				bytes: Uint8Array.from(await snapshot.blob(entry.entryId)).buffer,
			});
		}
	}
	// Explicit fixture sharing: A can compare both repos; B has only beta.
	await t.run((ctx) =>
		ctx.db.insert("grants", {
			principal: identityA.tokenIdentifier,
			resourceKind: "snapshot",
			resourceId: beta.summary.snapshotId,
			role: "reader",
			epoch: 1,
		}),
	);
	const open = {
		question:
			"Compare the exported marker functions in these two synthetic repositories.",
		snapshotIds: [alpha.summary.snapshotId, beta.summary.snapshotId],
		requestKey: "t11-open-comparison",
	};
	const investigation = await a.mutation(api.investigations.openInvestigation, {
		request: open,
	});
	return { t, a, b, open, investigation };
}

function sourceRequest(snapshot: GitSnapshot, path: string) {
	const entry = snapshot.entries.find((entry) => entry.displayPath === path);
	if (!entry) throw new Error("Missing source fixture");
	return { snapshotId: snapshot.summary.snapshotId, entryId: entry.entryId };
}

async function denial(promise: Promise<unknown>) {
	try {
		await promise;
	} catch (error) {
		if (error instanceof ConvexError) return error.data;
		throw error;
	}
	throw new Error("Expected an operation error, but the operation succeeded");
}

async function businessState(t: Awaited<ReturnType<typeof fixture>>["t"]) {
	return t.run(async (ctx) => ({
		investigations: await ctx.db.query("investigations").collect(),
		decisions: await ctx.db.query("decisions").collect(),
		receipts: await ctx.db.query("receipts").collect(),
		runs: await ctx.db.query("runs").collect(),
		jobs: await ctx.db.system.query("_scheduled_functions").collect(),
	}));
}

describe("T11 prerequisite integration: real sources and durable human decisions", () => {
	it("Q04/Q07: preserves two-repo refs and one correction across retries and a fresh client", async () => {
		const { t, a, open, investigation } = await fixture();
		expect(alpha.summary.commit).toBe(readManifest().repos.alpha.headCommit);
		expect(beta.summary.commit).toBe(readManifest().repos.beta.headCommit);
		expect(alpha.summary.rootTreeId).not.toBe(beta.summary.rootTreeId);
		expect(
			await a.mutation(api.investigations.openInvestigation, { request: open }),
		).toEqual(investigation);
		const refs = [];
		for (const snapshot of [alpha, beta]) {
			for (const file of FIXTURE_FILES.filter(
				(file) => file.repo === snapshot.repositoryId,
			)) {
				const request = sourceRequest(snapshot, file.path);
				const evidence = await a.query(api.sourceCache.readSource, { request });
				expect(evidence.content).toBe(file.content);
				expect(`sha256:${evidence.ref.digest}`).toBe(file.sha256);
				expect(evidence.ref).toMatchObject({
					repositoryId: snapshot.repositoryId,
					...request,
					commit: snapshot.summary.commit,
					hashAlgorithm: snapshot.summary.hashAlgorithm,
					blobId: snapshot.entry(request.entryId).objectId,
					byteRange: { start: 0, end: file.byteLength },
				});
				refs.push(evidence.ref);
			}
		}
		const request = {
			investigationId: investigation.investigationId,
			expectedRevision: 0,
			kind: "correction",
			category: "architecture",
			statement:
				"Keep alpha and beta marker implementations separate; shared shape does not prove shared behavior.",
			refs,
			requestKey: "t11-correction-once",
		};
		const saved = await a.mutation(api.decisions.recordDecision, { request });
		expect(saved.refs).toEqual(refs);
		expect(saved.statement).toBe(request.statement);
		expect(saved.category).toBe("architecture");
		expect(await a.mutation(api.decisions.recordDecision, { request })).toEqual(
			saved,
		);
		const state = await businessState(t);
		expect(
			await denial(
				a.mutation(api.decisions.recordDecision, {
					request: {
						...request,
						statement: "Changed payload under the same key",
					},
				}),
			),
		).toMatchObject({ code: "request_key_conflict" });
		expect(await businessState(t)).toEqual(state);
		expect(state.decisions).toHaveLength(1);
		const reopened = await t
			.withIdentity(identityA)
			.query(api.investigations.readInvestigation, {
				request: { investigationId: investigation.investigationId },
			});
		expect(reopened.revision).toBe(1);
		expect(reopened.decisions).toEqual([saved]);
		// Consume the persisted refs, rather than independently reconstructing a read.
		for (const ref of reopened.decisions?.[0].refs ?? []) {
			if (!ref.snapshotId) throw new Error("Persisted ref lost its snapshot");
			const evidence = await a.query(api.sourceCache.readSource, {
				request: {
					snapshotId: ref.snapshotId,
					entryId: ref.entryId,
					byteRange: ref.byteRange,
				},
			});
			expect(evidence.ref).toEqual(ref);
			expect(createHash("sha256").update(evidence.content).digest("hex")).toBe(
				ref.digest,
			);
		}
	});

	it("Q01: proves B's own access then denies A's refs and investigation without state or job changes", async () => {
		const { t, a, b, investigation } = await fixture();
		const own = await b.query(api.sourceCache.readSource, {
			request: sourceRequest(beta, "lib/beta.ts"),
		});
		expect(own.content).toContain("SYNTHETIC_BETA_MARKER_0001");
		const alphaRequest = sourceRequest(alpha, "src/alpha.ts");
		const foreignRef = (
			await a.query(api.sourceCache.readSource, { request: alphaRequest })
		).ref;
		const ownInvestigation = await b.mutation(
			api.investigations.openInvestigation,
			{
				request: {
					question: "B's permitted beta",
					snapshotIds: [beta.summary.snapshotId],
					requestKey: "t11-open-b-control",
				},
			},
		);
		const before = await businessState(t);
		const expected = { code: "not_found", message: "Resource not found" };
		for (const snapshotId of [alpha.summary.snapshotId, "missing-snapshot"]) {
			expect(
				await denial(
					b.query(api.sourceCache.readSource, {
						request: { ...alphaRequest, snapshotId },
					}),
				),
			).toEqual(expected);
		}
		for (const investigationId of [
			investigation.investigationId,
			"missing-investigation",
		]) {
			expect(
				await denial(
					b.query(api.investigations.readInvestigation, {
						request: { investigationId },
					}),
				),
			).toEqual(expected);
		}
		expect(
			await denial(
				b.mutation(api.decisions.recordDecision, {
					request: {
						investigationId: ownInvestigation.investigationId,
						expectedRevision: 0,
						kind: "constraint",
						statement: "Attempt to attach A's source",
						refs: [foreignRef],
						requestKey: "t11-foreign-reference",
					},
				}),
			),
		).toEqual(expected);
		expect(await businessState(t)).toEqual(before);
	});

	it("Q06: fences a deterministic late proposal after a correction, preserving exact source refs on reopen", async () => {
		const { t, a, investigation } = await fixture();
		const evidence = await a.query(api.sourceCache.readSource, {
			request: sourceRequest(alpha, "src/alpha.ts"),
		});
		const run = await a.mutation(api.runs.admitRun, {
			request: {
				investigationId: investigation.investigationId,
				expectedRevision: 0,
				purpose: "Synthetic stale-publication regression; no model dispatched",
				requestKey: "t11-admit-late-run",
			},
		});
		const decision = await a.mutation(api.decisions.recordDecision, {
			request: {
				investigationId: investigation.investigationId,
				expectedRevision: 0,
				kind: "correction",
				statement:
					"Retain the actual alpha marker; do not substitute beta's behavior.",
				refs: [evidence.ref],
				requestKey: "t11-correct-before-publish",
			},
		});
		expect(
			await t.mutation(internal.runs.publish, {
				request: {
					investigationId: investigation.investigationId,
					runId: run.runId,
					baseRevision: 0,
					claims: [
						{
							statement: "Synthetic obsolete claim",
							evidenceClass: "model_hypothesis",
							refs: [evidence.ref],
						},
					],
				},
			}),
		).toEqual({ published: false, status: "superseded" });
		const reopened = await t
			.withIdentity(identityA)
			.query(api.investigations.readInvestigation, {
				request: { investigationId: investigation.investigationId },
			});
		expect(reopened.revision).toBe(1);
		expect(reopened.decisions).toEqual([decision]);
		expect(reopened.acceptedFindings ?? []).toEqual([]);
		expect(
			await a.query(api.runs.getRun, { request: { runId: run.runId } }),
		).toMatchObject({ status: "superseded" });
		// Positive publication control: a current-revision result can publish, so
		// a handler that rejects every result cannot make the stale case pass.
		const current = await a.mutation(api.runs.admitRun, {
			request: {
				investigationId: investigation.investigationId,
				expectedRevision: 1,
				purpose: "Synthetic positive publication control",
				requestKey: "t11-current-run-control",
			},
		});
		expect(
			await t.mutation(internal.runs.publish, {
				request: {
					investigationId: investigation.investigationId,
					runId: current.runId,
					baseRevision: 1,
					claims: [
						{
							statement: "Synthetic current-revision control",
							evidenceClass: "model_hypothesis",
							refs: [evidence.ref],
						},
					],
				},
			}),
		).toEqual({ published: true, status: "published" });
		const afterPublication = await a.query(
			api.investigations.readInvestigation,
			{ request: { investigationId: investigation.investigationId } },
		);
		expect(afterPublication.decisions).toEqual([decision]);
		expect(afterPublication.acceptedFindings).toMatchObject([
			{
				summary: "Synthetic current-revision control",
				refs: [evidence.ref],
				verification: "unverified",
			},
		]);
		expect((await businessState(t)).jobs).toEqual([]);
	});
});
