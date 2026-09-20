// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import type { Project } from "../../generated/types";

const modules = import.meta.glob("../../convex/**/*.ts");
const ownerTokenIdentifier = "https://operator.example|catalog-owner";
const identity = (subject: string) => ({
	issuer: "https://accounts.example",
	subject,
	tokenIdentifier: `https://accounts.example|${subject}`,
});
async function fixture() {
	const t = convexTest(schema, modules);
	for (const n of [1, 2, 3, 4]) {
		const project: Project = {
			repositoryId: `repo${n}`,
			displayName: `Public ${n}`,
			provider: "local-git",
			dataLabel: "public",
			syncStatus: "ready",
			snapshots: [
				{
					snapshotId: `snapshot${n}`,
					commit: "a".repeat(40),
					rootTreeId: "b".repeat(40),
					hashAlgorithm: "sha1",
					indexedAt: 1,
					coverage: "not_indexed",
				},
			],
		};
		await t.mutation(internal.operatorProvisioning.registerSnapshot, {
			ownerTokenIdentifier,
			input: { project, entries: [] },
		});
		if (n !== 4)
			await t.mutation(internal.operatorProvisioning.setDemoCatalog, {
				ownerTokenIdentifier,
				input: { snapshotId: `snapshot${n}`, enabled: true },
			});
	}
	return {
		t,
		a: t.withIdentity(identity("a")),
		b: t.withIdentity(identity("b")),
	};
}
const claim = { request: { requestKey: "catalog-request-001" } };
const open = {
	question: "Private investigation",
	snapshotIds: ["snapshot1"] as [string],
	requestKey: "private-open-request",
};

describe("public demo catalog and private human work", () => {
	test("two accounts share exactly three reader snapshots, but not investigations, decisions or briefs", async () => {
		const { t, a, b } = await fixture();
		const first = await a.mutation(api.catalog.claimDemoAccess, claim);
		expect(first.scope.snapshotIds).toEqual([
			"snapshot1",
			"snapshot2",
			"snapshot3",
		]);
		expect(await a.mutation(api.catalog.claimDemoAccess, claim)).toEqual(first);
		await b.mutation(api.catalog.claimDemoAccess, claim);
		await a.mutation(api.catalog.claimDemoAccess, {
			request: { requestKey: "different-catalog-key" },
		});
		const grants = await t.run((ctx) => ctx.db.query("grants").collect());
		expect(
			grants.filter((g) => g.principal === identity("a").tokenIdentifier),
		).toHaveLength(3);
		expect(
			grants
				.filter((g) => g.principal === identity("a").tokenIdentifier)
				.every((g) => g.role === "reader"),
		).toBe(true);
		const ai = await a.mutation(api.investigations.openInvestigation, {
			request: open,
		});
		const bi = await b.mutation(api.investigations.openInvestigation, {
			request: open,
		});
		expect(ai.investigationId).not.toBe(bi.investigationId);
		const decision = await a.mutation(api.decisions.recordDecision, {
			request: {
				investigationId: ai.investigationId,
				kind: "constraint",
				statement: "Private human direction",
				expectedRevision: 0,
				requestKey: "catalog-decision",
			},
		});
		expect(
			(
				await a.query(api.investigations.readInvestigation, {
					request: { investigationId: ai.investigationId },
				})
			).decisions,
		).toEqual([decision]);
		const brief = await a.mutation(api.handoffs.prepareHandoff, {
			request: {
				investigationId: ai.investigationId,
				expectedRevision: 1,
				targetRepositoryId: "repo1",
				audience: "private_download",
				requestKey: "private-brief",
			},
		});
		await expect(
			b.query(api.handoffs.readHandoff, {
				request: { handoffId: brief.handoffId },
			}),
		).rejects.toMatchObject({ data: { code: "not_found" } });
		await expect(
			b.query(api.investigations.readInvestigation, {
				request: { investigationId: ai.investigationId },
			}),
		).rejects.toMatchObject({ data: { code: "not_found" } });
		await expect(
			b.mutation(api.decisions.recordDecision, {
				request: {
					investigationId: ai.investigationId,
					kind: "constraint",
					statement: "Attack",
					expectedRevision: 1,
					requestKey: "foreign-decision",
				},
			}),
		).rejects.toMatchObject({ data: { code: "not_found" } });
		await expect(
			a.mutation(api.investigations.openInvestigation, {
				request: {
					...open,
					snapshotIds: ["snapshot4"],
					requestKey: "noncatalog-open",
				},
			}),
		).rejects.toMatchObject({ data: { code: "not_found" } });
		await expect(
			a.mutation(internal.sourceCache.put, {
				snapshotId: "snapshot1",
				entryId: "missing",
				bytes: new ArrayBuffer(0),
			}),
		).rejects.toMatchObject({ data: { code: "not_found" } });
		await expect(
			a.mutation(internal.operatorProvisioning.setDemoCatalog, {
				ownerTokenIdentifier,
				input: { snapshotId: "snapshot4", enabled: true },
			}),
		).rejects.toMatchObject({ data: { code: "not_found" } });
	});

	test.each([
		"grant revocation",
		"catalog withdrawal",
		"catalog epoch",
	])("%s denies replays/new claims and fences admitted publication", async (mode) => {
		const { t, a } = await fixture();
		await a.mutation(api.catalog.claimDemoAccess, claim);
		const investigation = await a.mutation(
			api.investigations.openInvestigation,
			{ request: open },
		);
		const run = await a.mutation(api.runs.admitRun, {
			request: {
				investigationId: investigation.investigationId,
				expectedRevision: 0,
				purpose: "compare",
				requestKey: "catalog-run-request",
			},
		});
		if (mode === "grant revocation")
			await t.run(async (ctx) => {
				const grant = await ctx.db
					.query("grants")
					.withIndex("by_principal_resource", (q) =>
						q
							.eq("principal", identity("a").tokenIdentifier)
							.eq("resourceKind", "snapshot")
							.eq("resourceId", "snapshot1"),
					)
					.unique();
				if (!grant) throw new Error("Missing fixture grant");
				await ctx.db.patch(grant._id, {
					revokedAt: Date.now(),
					epoch: grant.epoch + 1,
				});
			});
		else {
			await t.mutation(internal.operatorProvisioning.setDemoCatalog, {
				ownerTokenIdentifier,
				input: { snapshotId: "snapshot1", enabled: false },
			});
			if (mode === "catalog epoch")
				await t.mutation(internal.operatorProvisioning.setDemoCatalog, {
					ownerTokenIdentifier,
					input: { snapshotId: "snapshot1", enabled: true },
				});
		}
		await expect(
			a.mutation(api.catalog.claimDemoAccess, claim),
		).rejects.toMatchObject({ data: { code: "not_found" } });
		if (mode !== "catalog withdrawal")
			await expect(
				a.mutation(api.catalog.claimDemoAccess, {
					request: { requestKey: "try-new-key" },
				}),
			).rejects.toMatchObject({ data: { code: "not_found" } });
		await expect(
			a.query(api.investigations.readInvestigation, {
				request: { investigationId: investigation.investigationId },
			}),
		).rejects.toMatchObject({ data: { code: "not_found" } });
		expect(
			await t.mutation(internal.runs.publish, {
				request: {
					investigationId: investigation.investigationId,
					baseRevision: 0,
					runId: run.runId,
					claims: [
						{
							statement: "Late claim",
							evidenceClass: "model_hypothesis",
							refs: [
								{
									repositoryId: "repo1",
									snapshotId: "snapshot1",
									commit: "a".repeat(40),
									hashAlgorithm: "sha1",
									blobId: "b".repeat(40),
									entryId: "entry1",
									byteRange: { start: 0, end: 1 },
									digest: "c".repeat(64),
								},
							],
						},
					],
				},
			}),
		).toEqual({ published: false, status: "superseded" });
		const listed = await a.query(api.projects.listProjects, { request: {} });
		expect(listed.scope.snapshotIds).not.toContain("snapshot1");
	});

	test("manual owner grants survive claims and catalog withdrawal without role changes", async () => {
		const { t } = await fixture();
		const operator = t.withIdentity({
			issuer: "https://operator.example",
			subject: "catalog-owner",
			tokenIdentifier: ownerTokenIdentifier,
		});
		const before = await t.run((ctx) => ctx.db.query("grants").collect());
		await operator.mutation(api.catalog.claimDemoAccess, claim);
		expect(await t.run((ctx) => ctx.db.query("grants").collect())).toEqual(
			before,
		);
		await t.mutation(internal.operatorProvisioning.setDemoCatalog, {
			ownerTokenIdentifier,
			input: { snapshotId: "snapshot1", enabled: false },
		});
		const investigation = await operator.mutation(
			api.investigations.openInvestigation,
			{ request: open },
		);
		expect(investigation.snapshotIds).toEqual(["snapshot1"]);
		await expect(
			operator.mutation(api.catalog.claimDemoAccess, claim),
		).rejects.toMatchObject({ data: { code: "not_found" } });
	});

	test("receipts retain IDs only and replay the original catalog after an addition", async () => {
		const { t, a } = await fixture();
		const original = await a.mutation(api.catalog.claimDemoAccess, claim);
		await t.mutation(internal.operatorProvisioning.setDemoCatalog, {
			ownerTokenIdentifier,
			input: { snapshotId: "snapshot4", enabled: true },
		});
		expect(await a.mutation(api.catalog.claimDemoAccess, claim)).toEqual(
			original,
		);
		const fresh = await a.mutation(api.catalog.claimDemoAccess, {
			request: { requestKey: "claim-expanded-catalog" },
		});
		expect(fresh.scope.snapshotIds).toHaveLength(4);
		const state = await t.run(async (ctx) => ({
			receipts: await ctx.db.query("receipts").collect(),
			claims: await ctx.db.query("catalogClaims").collect(),
		}));
		for (const receipt of state.receipts) {
			expect(receipt.resultKind).toBe("catalog");
			expect(Object.keys(receipt).sort()).toEqual(
				[
					"_creationTime",
					"_id",
					"digest",
					"operationId",
					"principal",
					"requestKey",
					"resultId",
					"resultKind",
				].sort(),
			);
		}
		for (const stored of state.claims)
			expect(Object.keys(stored).sort()).toEqual(
				["_creationTime", "_id", "principal", "snapshots"].sort(),
			);
	});

	test("unauthenticated and smuggled identities are rejected without grants", async () => {
		const { t, a } = await fixture();
		await expect(
			t.mutation(api.catalog.claimDemoAccess, claim),
		).rejects.toMatchObject({ data: { code: "unauthenticated" } });
		for (const extra of [
			{ owner: "other" },
			{ snapshotIds: ["snapshot4"] },
			{ principal: "other" },
		]) {
			await expect(
				a.mutation(api.catalog.claimDemoAccess, {
					request: { ...claim.request, ...extra },
				}),
			).rejects.toMatchObject({ data: { code: "invalid_request" } });
		}
		expect(
			await t.run((ctx) => ctx.db.query("catalogClaims").collect()),
		).toEqual([]);
	});
});
