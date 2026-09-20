// @vitest-environment edge-runtime

/**
 * T11 - integrated regression of the question/evidence/correction/reopen loop.
 *
 * Layer: LOCAL. Real Convex handlers under convex-test, synthetic metadata fixtures,
 * fixed fixture principals. Not live, not deployed, no hosted identity.
 *
 * What this does NOT cover, and must not be reported as covering:
 *   - No reasoning driver. The "model" publication is this test calling
 *     internal.runs.publish directly. Q15 stays NOT RUN until T10 supplies a real
 *     driver and the loop is recorded.
 *   - No brief. prepareHandoff/readHandoff have no handler at ecd0be2; T09 (PR #20)
 *     adds them. Extend the loop to prepare -> read -> body-hash once that merges.
 *   - Exact bytes are T05/Q04's job. The refs here resolve against indexed rows only.
 */

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import type { OperationError, SourceRef } from "../../generated/types";
import { PRINCIPAL_A, PRINCIPAL_B } from "../fixtures/identities";

const modules = import.meta.glob("../../convex/**/*.ts");

function identity(principal: typeof PRINCIPAL_A) {
	return {
		tokenIdentifier: `${principal.issuer}|${principal.subject}`,
		subject: principal.subject,
		issuer: principal.issuer,
	};
}
const identityA = identity(PRINCIPAL_A);
const identityB = identity(PRINCIPAL_B);

// A owns two repositories (Q15 needs a cross-repo question); B owns one.
const SNAPSHOTS = [
	["A1", identityA.tokenIdentifier],
	["A2", identityA.tokenIdentifier],
	["B", identityB.tokenIdentifier],
] as const;

function refTo(suffix: string): SourceRef {
	return {
		repositoryId: `repo_${suffix}`,
		snapshotId: `snapshot_${suffix}`,
		entryId: `entry_${suffix}`,
		commit: "a".repeat(40),
		blobId: "b".repeat(40),
		hashAlgorithm: "sha1",
		byteRange: { start: 0, end: 1 },
		digest: "c".repeat(64),
	};
}

async function fixture() {
	const t = convexTest(schema, modules);
	await t.run(async (ctx) => {
		for (const [suffix, principal] of SNAPSHOTS) {
			await ctx.db.insert("snapshots", {
				snapshotId: `snapshot_${suffix}`,
				repositoryId: `repo_${suffix}`,
				cursorSecret: `fixture-${suffix}`,
				registrationDigest: "fixture",
				project: JSON.stringify({
					repositoryId: `repo_${suffix}`,
					displayName: "Synthetic fixture",
					provider: "local-git",
					syncStatus: "ready",
					snapshots: [
						{
							snapshotId: `snapshot_${suffix}`,
							commit: "a".repeat(40),
							hashAlgorithm: "sha1",
							rootTreeId: "e".repeat(40),
							indexedAt: 0,
							coverage: "not_indexed",
						},
					],
				}),
			});
			await ctx.db.insert("entries", {
				snapshotId: `snapshot_${suffix}`,
				entryId: `entry_${suffix}`,
				parentEntryId: null,
				body: JSON.stringify({
					snapshotId: `snapshot_${suffix}`,
					entryId: `entry_${suffix}`,
					parentEntryId: null,
					name: "source.ts",
					kind: "blob",
					objectId: "b".repeat(40),
					size: 4096,
				}),
			});
			await ctx.db.insert("grants", {
				principal,
				resourceKind: "snapshot",
				resourceId: `snapshot_${suffix}`,
				role: "owner",
				epoch: 1,
			});
		}
	});
	return { t, a: t.withIdentity(identityA), b: t.withIdentity(identityB) };
}

async function errorOf(promise: Promise<unknown>): Promise<OperationError> {
	try {
		await promise;
	} catch (error) {
		if (!(error instanceof ConvexError)) throw error;
		return (
			typeof error.data === "string" ? JSON.parse(error.data) : error.data
		) as OperationError;
	}
	throw new Error("Expected operation to reject");
}

async function state(t: Awaited<ReturnType<typeof fixture>>["t"]) {
	return t.run(async (ctx) => ({
		investigations: await ctx.db.query("investigations").collect(),
		decisions: await ctx.db.query("decisions").collect(),
		runs: await ctx.db.query("runs").collect(),
		receipts: await ctx.db.query("receipts").collect(),
		grants: await ctx.db.query("grants").collect(),
		jobs: await ctx.db.system.query("_scheduled_functions").collect(),
	}));
}

const NOT_FOUND = { code: "not_found", message: "Resource not found" };

describe("T11 integrated loop, local real handlers", () => {
	test("question -> late proposal -> correction -> changed result -> reopen, with a foreign principal probing throughout", async () => {
		const { t, a, b } = await fixture();

		// Question across two repositories.
		const inv = await a.mutation(api.investigations.openInvestigation, {
			request: {
				question: "Can project three reuse the contract without the worker?",
				snapshotIds: ["snapshot_A1", "snapshot_A2"],
				requestKey: "t11-open-0001",
			},
		});

		// A run is admitted at revision 0 and is still "thinking".
		const lateRun = await a.mutation(api.runs.admitRun, {
			request: {
				investigationId: inv.investigationId,
				expectedRevision: 0,
				purpose: "compare",
				requestKey: "t11-run-0001",
			},
		});

		// Human correction lands first: revision 0 -> 1.
		const correction = {
			investigationId: inv.investigationId,
			expectedRevision: 0,
			kind: "correction" as const,
			statement: "Reuse the contract only; reject the permanent worker runtime",
			requestKey: "t11-decision-0001",
		};
		const decided = await a.mutation(api.decisions.recordDecision, {
			request: correction,
		});

		// Q06: the revision-0 proposal arrives after the correction and is rejected.
		expect(
			await t.mutation(internal.runs.publish, {
				request: {
					investigationId: inv.investigationId,
					runId: lateRun.runId,
					baseRevision: 0,
					claims: [
						{
							statement: "Adopt the worker runtime from repo A1",
							evidenceClass: "model_hypothesis",
							refs: [refTo("A1")],
						},
					],
				},
			}),
		).toEqual({ published: false, status: "superseded" });
		const afterLate = await a.query(api.investigations.readInvestigation, {
			request: { investigationId: inv.investigationId },
		});
		expect(afterLate.decisions).toHaveLength(1);
		expect(afterLate.acceptedFindings ?? []).toHaveLength(0);

		// Q07: same key replays to the same result; same key, changed payload conflicts.
		expect(
			await a.mutation(api.decisions.recordDecision, { request: correction }),
		).toEqual(decided);
		expect(
			(
				await errorOf(
					a.mutation(api.decisions.recordDecision, {
						request: { ...correction, statement: "Adopt the worker after all" },
					}),
				)
			).code,
		).toBe("request_key_conflict");
		expect((await state(t)).decisions).toHaveLength(1);

		// Changed result: a run based on the corrected revision publishes, citing repo A2.
		const freshRun = await a.mutation(api.runs.admitRun, {
			request: {
				investigationId: inv.investigationId,
				expectedRevision: 1,
				purpose: "compare",
				requestKey: "t11-run-0002",
			},
		});
		expect(
			await t.mutation(internal.runs.publish, {
				request: {
					investigationId: inv.investigationId,
					runId: freshRun.runId,
					baseRevision: 1,
					claims: [
						{
							statement: "Contract in repo A2 is reusable without the worker",
							evidenceClass: "model_hypothesis",
							refs: [refTo("A2")],
						},
					],
				},
			}),
		).toEqual({ published: true, status: "published" });

		// Q01: B substitutes A's identifiers. Foreign is indistinguishable from missing,
		// and nothing moves: no rows, no receipts, no scheduled jobs.
		const before = await state(t);
		for (const id of [inv.investigationId, "missing_investigation"]) {
			expect(
				await errorOf(
					b.query(api.investigations.readInvestigation, {
						request: { investigationId: id },
					}),
				),
			).toEqual(NOT_FOUND);
			expect(
				await errorOf(
					b.mutation(api.decisions.recordDecision, {
						request: {
							...correction,
							investigationId: id,
							expectedRevision: 1,
						},
					}),
				),
			).toEqual(NOT_FOUND);
		}
		for (const runId of [freshRun.runId, "missing_run"])
			expect(
				await errorOf(b.query(api.runs.getRun, { request: { runId } })),
			).toEqual(NOT_FOUND);
		expect(
			(
				await errorOf(
					b.mutation(api.investigations.openInvestigation, {
						request: {
							question: "Borrow A's repository",
							snapshotIds: ["snapshot_B", "snapshot_A1"],
							requestKey: "t11-open-foreign",
						},
					}),
				)
			).code,
		).toBe("not_found");
		const after = await state(t);
		expect(after).toEqual(before);
		expect(after.jobs).toHaveLength(0);

		// Reopen: a fresh read returns the human decision and only the post-correction
		// finding, tied to its exact ref.
		const reopened = await a.query(api.investigations.readInvestigation, {
			request: { investigationId: inv.investigationId },
		});
		expect(reopened.question).toBe(
			"Can project three reuse the contract without the worker?",
		);
		expect(reopened.decisions).toHaveLength(1);
		expect(JSON.stringify(reopened.decisions)).toContain(correction.statement);
		expect(reopened.acceptedFindings).toMatchObject([
			{
				summary: "Contract in repo A2 is reusable without the worker",
				verification: "unverified",
			},
		]);
		expect(JSON.stringify(reopened.acceptedFindings)).toContain("snapshot_A2");
		expect(JSON.stringify(reopened)).not.toContain("Adopt the worker runtime");
	});

	test("revoking one of two repositories mid-loop fences the run, denies the owner, and leaves B's view unchanged", async () => {
		const { t, a, b } = await fixture();
		const inv = await a.mutation(api.investigations.openInvestigation, {
			request: {
				question: "Compare both repositories",
				snapshotIds: ["snapshot_A1", "snapshot_A2"],
				requestKey: "t11-revoke-open",
			},
		});
		const run = await a.mutation(api.runs.admitRun, {
			request: {
				investigationId: inv.investigationId,
				expectedRevision: 0,
				purpose: "compare",
				requestKey: "t11-revoke-run",
			},
		});
		const ownB = await b.mutation(api.investigations.openInvestigation, {
			request: {
				question: "B's own question",
				snapshotIds: ["snapshot_B"],
				requestKey: "t11-revoke-open-b",
			},
		});

		await t.run(async (ctx) => {
			for (const grant of await ctx.db.query("grants").collect())
				if (grant.resourceId === "snapshot_A2")
					await ctx.db.patch(grant._id, { revokedAt: Date.now() });
		});

		// The in-flight run cannot publish evidence from either repository any more.
		expect(
			await t.mutation(internal.runs.publish, {
				request: {
					investigationId: inv.investigationId,
					runId: run.runId,
					baseRevision: 0,
					claims: [
						{
							statement: "Result computed before revocation",
							evidenceClass: "model_hypothesis",
							refs: [refTo("A2")],
						},
					],
				},
			}),
		).toEqual({ published: false, status: "superseded" });

		// A is denied as if the resources were missing; no partial view through A1.
		const before = await state(t);
		const denied = await Promise.all(
			[
				a.query(api.investigations.readInvestigation, {
					request: { investigationId: inv.investigationId },
				}),
				a.query(api.runs.getRun, { request: { runId: run.runId } }),
				a.mutation(api.decisions.recordDecision, {
					request: {
						investigationId: inv.investigationId,
						expectedRevision: 0,
						kind: "correction" as const,
						statement: "Written after revocation",
						requestKey: "t11-revoke-decision",
					},
				}),
				a.mutation(api.investigations.openInvestigation, {
					request: {
						question: "Reopen with the revoked repository",
						snapshotIds: ["snapshot_A1", "snapshot_A2"],
						requestKey: "t11-revoke-reopen",
					},
				}),
			].map(errorOf),
		);
		for (const error of denied) expect(error).toEqual(NOT_FOUND);
		expect(await state(t)).toEqual(before);

		// Positive control: the unrevoked principal still works.
		expect(
			(
				await b.query(api.investigations.readInvestigation, {
					request: { investigationId: ownB.investigationId },
				})
			).question,
		).toBe("B's own question");
	});
});
