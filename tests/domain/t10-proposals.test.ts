// @vitest-environment edge-runtime
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import type { OperationError, Project, Proposal } from "../../generated/types";
import * as validators from "../../generated/validators.js";
import { type GitSnapshot, openSnapshot } from "../../src/server/git/snapshot";
import { PRINCIPAL_A, PRINCIPAL_B } from "../fixtures/identities";
import { bundlePath } from "../fixtures/repos/cases";

const modules = import.meta.glob("../../convex/**/*.ts");
const identity = (p: typeof PRINCIPAL_A | typeof PRINCIPAL_B) => ({
	issuer: p.issuer,
	subject: p.subject,
	tokenIdentifier: `${p.issuer}|${p.subject}`,
});
let snapshot: GitSnapshot;
beforeAll(async () => {
	snapshot = await openSnapshot({
		repositoryId: "alpha",
		bundlePath: bundlePath("alpha"),
	});
});
afterAll(async () => {
	await snapshot?.close();
});

async function fixture() {
	const t = convexTest(schema, modules);
	const a = t.withIdentity(identity(PRINCIPAL_A));
	const b = t.withIdentity(identity(PRINCIPAL_B));
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
	const entry = snapshot.entries.find((e) => e.displayPath === "src/alpha.ts");
	if (!entry) throw new Error("Fixture source absent");
	const source = {
		snapshotId: snapshot.summary.snapshotId,
		entryId: entry.entryId,
	};
	await a.mutation(internal.sourceCache.put, {
		...source,
		bytes: Uint8Array.from(await snapshot.blob(entry.entryId)).buffer,
	});
	const evidence = await a.query(api.sourceCache.readSource, {
		request: { ...source, byteRange: { start: 0, end: 60 } },
	});
	const investigation = await a.mutation(api.investigations.openInvestigation, {
		request: {
			question: "Compare evidence",
			snapshotIds: [source.snapshotId],
			requestKey: "open-host-fixture",
		},
	});
	const admission = {
		investigationId: investigation.investigationId,
		expectedRevision: 0,
		purpose: "Compare source",
		requestKey: "begin-host-fixture",
	};
	const run = await a.mutation(api.runs.beginHostRun, { request: admission });
	const proposal: Proposal = {
		investigationId: investigation.investigationId,
		runId: run.runId,
		baseRevision: 0,
		claims: [
			{
				statement: "Tentative comparison",
				evidenceClass: "model_hypothesis",
				refs: [evidence.ref],
			},
		],
	};
	const request = { proposal, requestKey: "submit-host-fixture" };
	return {
		t,
		a,
		b,
		source,
		evidence,
		investigation,
		admission,
		run,
		proposal,
		request,
	};
}
async function errorOf(promise: Promise<unknown>): Promise<OperationError> {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(ConvexError);
		if (!(error instanceof ConvexError)) throw error;
		const data: unknown =
			typeof error.data === "string" ? JSON.parse(error.data) : error.data;
		expect(validators.OperationError(data)).toBe(true);
		return data as OperationError;
	}
	throw new Error("Expected operation error");
}
const forbidden = { code: "not_found", message: "Resource not found" };
async function state(f: Awaited<ReturnType<typeof fixture>>) {
	return f.t.run(async (ctx) => ({
		investigations: await ctx.db.query("investigations").collect(),
		decisions: await ctx.db.query("decisions").collect(),
		runs: await ctx.db.query("runs").collect(),
		receipts: await ctx.db.query("receipts").collect(),
	}));
}
async function grant(
	f: Awaited<ReturnType<typeof fixture>>,
	resourceKind: "snapshot" | "investigation",
	resourceId: string,
	role: "reader" | "owner",
) {
	return f.t.run((ctx) =>
		ctx.db.insert("grants", {
			principal: identity(PRINCIPAL_B).tokenIdentifier,
			resourceKind,
			resourceId,
			role,
			epoch: 1,
		}),
	);
}

describe("T10 admitted host proposals through real handlers", () => {
	test("captures admission fences, reads exact source, publishes once and retains human correction", async () => {
		const f = await fixture();
		expect(f.run).toMatchObject({
			driver: "host",
			status: "admitted",
			baseRevision: 0,
		});
		const row = (await state(f)).runs[0];
		expect(row.fences).toHaveLength(2);
		const published = await f.a.mutation(api.proposals.submitProposal, {
			request: f.request,
		});
		expect(published).toMatchObject({
			revision: 0,
			status: "awaiting_human",
			acceptedFindings: [
				{
					verification: "unverified",
					evidenceClass: "model_hypothesis",
					refs: [f.evidence.ref],
				},
			],
		});
		expect(
			await f.a.query(api.runs.getRun, { request: { runId: f.run.runId } }),
		).toMatchObject({ status: "published" });
		const before = await state(f);
		expect(
			await f.a.mutation(api.proposals.submitProposal, {
				request: {
					requestKey: f.request.requestKey,
					proposal: {
						claims: f.proposal.claims,
						baseRevision: 0,
						runId: f.run.runId,
						investigationId: f.investigation.investigationId,
					},
				},
			}),
		).toEqual(published);
		expect(await state(f)).toEqual(before);
		expect(before.receipts.every((r) => !("body" in r))).toBe(true);
		const decision = await f.a.mutation(api.decisions.recordDecision, {
			request: {
				investigationId: f.investigation.investigationId,
				expectedRevision: 0,
				kind: "correction",
				statement: "Keep the human correction",
				requestKey: "human-correction",
			},
		});
		const current = await f.a.query(api.investigations.readInvestigation, {
			request: { investigationId: f.investigation.investigationId },
		});
		expect(current).toMatchObject({ revision: 1, decisions: [decision] });
		expect(
			await errorOf(
				f.a.mutation(api.proposals.submitProposal, {
					request: { ...f.request, requestKey: "late-proposal-key" },
				}),
			),
		).toMatchObject({ code: "revision_conflict", currentRevision: 1 });
		expect((await state(f)).decisions).toHaveLength(1);
	});
	test("host admission replays, conflicts and shares the active-run gate with backend admission", async () => {
		const f = await fixture();
		expect(
			await f.a.mutation(api.runs.beginHostRun, { request: f.admission }),
		).toEqual(f.run);
		expect(
			await errorOf(
				f.a.mutation(api.runs.beginHostRun, {
					request: { ...f.admission, purpose: "Different" },
				}),
			),
		).toMatchObject({ code: "request_key_conflict" });
		expect(
			await errorOf(f.a.mutation(api.runs.admitRun, { request: f.admission })),
		).toMatchObject({ code: "limit_exceeded" });
		await f.a.mutation(api.runs.cancelRun, {
			request: { runId: f.run.runId, requestKey: "cancel-host-key" },
		});
		const backend = await f.a.mutation(api.runs.admitRun, {
			request: f.admission,
		});
		expect(backend.driver).toBe("backend");
		expect(
			await errorOf(
				f.a.mutation(api.proposals.submitProposal, {
					request: {
						...f.request,
						proposal: { ...f.proposal, runId: backend.runId },
					},
				}),
			),
		).toMatchObject({ code: "unsupported" });
	});
	test("requires admission, verified identity, and matching admitted revision", async () => {
		const f = await fixture();
		const before = await state(f);
		expect(
			await errorOf(
				f.t.mutation(api.proposals.submitProposal, { request: f.request }),
			),
		).toMatchObject({ code: "unauthenticated" });
		const { runId: _run, ...withoutRun } = f.proposal;
		expect(
			await errorOf(
				f.a.mutation(api.proposals.submitProposal, {
					request: { ...f.request, proposal: withoutRun },
				}),
			),
		).toMatchObject({
			code: "invalid_request",
			details: [{ path: "/proposal/runId" }],
		});
		expect(
			await errorOf(
				f.a.mutation(api.proposals.submitProposal, {
					request: {
						...f.request,
						proposal: { ...f.proposal, baseRevision: 1 },
					},
				}),
			),
		).toMatchObject({ code: "revision_conflict" });
		expect(await state(f)).toEqual(before);
	});
	test("foreign, missing and wrong-table IDs produce identical errors without changes", async () => {
		const f = await fixture();
		const before = await state(f);
		for (const investigationId of [
			f.investigation.investigationId,
			"missing-investigation",
			f.run.runId,
		]) {
			expect(
				await errorOf(
					f.b.mutation(api.proposals.submitProposal, {
						request: {
							...f.request,
							proposal: { ...f.proposal, investigationId },
						},
					}),
				),
			).toEqual(forbidden);
		}
		for (const runId of ["missing-run", f.investigation.investigationId]) {
			expect(
				await errorOf(
					f.a.mutation(api.proposals.submitProposal, {
						request: { ...f.request, proposal: { ...f.proposal, runId } },
					}),
				),
			).toEqual(forbidden);
		}
		expect(await state(f)).toEqual(before);
	});
	test("sharing an investigation does not authorize publishing another principal's run", async () => {
		const f = await fixture();
		await grant(f, "snapshot", f.source.snapshotId, "reader");
		await grant(f, "investigation", f.investigation.investigationId, "owner");
		expect(
			await errorOf(
				f.b.mutation(api.proposals.submitProposal, { request: f.request }),
			),
		).toEqual(forbidden);
		expect(
			await errorOf(
				f.b.mutation(api.proposals.submitProposal, {
					request: {
						...f.request,
						proposal: { ...f.proposal, runId: "missing-run" },
					},
				}),
			),
		).toEqual(forbidden);
	});
	test("snapshot readers can admit and publish in their own investigation, not a shared reader investigation", async () => {
		const f = await fixture();
		await grant(f, "snapshot", f.source.snapshotId, "reader");
		await grant(f, "investigation", f.investigation.investigationId, "reader");
		expect(
			await errorOf(
				f.b.mutation(api.runs.beginHostRun, { request: f.admission }),
			),
		).toEqual(forbidden);
		expect(
			await errorOf(
				f.b.mutation(api.proposals.submitProposal, { request: f.request }),
			),
		).toEqual(forbidden);
		const own = await f.b.mutation(api.investigations.openInvestigation, {
			request: {
				question: "Reader's own investigation",
				snapshotIds: [f.source.snapshotId],
				requestKey: "reader-open-own",
			},
		});
		const run = await f.b.mutation(api.runs.beginHostRun, {
			request: { ...f.admission, investigationId: own.investigationId },
		});
		const published = await f.b.mutation(api.proposals.submitProposal, {
			request: {
				...f.request,
				proposal: {
					...f.proposal,
					investigationId: own.investigationId,
					runId: run.runId,
				},
			},
		});
		expect(published.acceptedFindings).toHaveLength(1);
	});
	test.each([
		"decision",
		"cancel",
		"epoch",
		"revoke",
	] as const)("rejects publication after %s", async (change) => {
		const f = await fixture();
		if (change === "decision")
			await f.a.mutation(api.decisions.recordDecision, {
				request: {
					investigationId: f.investigation.investigationId,
					expectedRevision: 0,
					kind: "correction",
					statement: "Durable correction",
					requestKey: "fence-decision",
				},
			});
		if (change === "cancel")
			await f.a.mutation(api.runs.cancelRun, {
				request: { runId: f.run.runId, requestKey: "fence-cancel-key" },
			});
		if (change === "epoch" || change === "revoke")
			await f.t.run(async (ctx) => {
				const row = await ctx.db
					.query("grants")
					.withIndex("by_principal_resource", (q) =>
						q
							.eq("principal", identity(PRINCIPAL_A).tokenIdentifier)
							.eq("resourceKind", "snapshot")
							.eq("resourceId", f.source.snapshotId),
					)
					.unique();
				if (!row) throw new Error("Missing fixture grant");
				await ctx.db.patch(
					row._id,
					change === "epoch"
						? { epoch: row.epoch + 1 }
						: { revokedAt: Date.now() },
				);
			});
		const before = await state(f);
		expect(
			await errorOf(
				f.a.mutation(api.proposals.submitProposal, { request: f.request }),
			),
		).toMatchObject({
			code:
				change === "decision"
					? "revision_conflict"
					: change === "revoke"
						? "not_found"
						: "unsupported",
		});
		expect(await state(f)).toEqual(before);
		if (change === "decision")
			expect((await state(f)).decisions).toHaveLength(1);
		// Internal publication returns rejection instead of throwing, so its fence status commits.
		expect(
			await f.t.mutation(internal.runs.publish, { request: f.proposal }),
		).toEqual({
			published: false,
			status: change === "cancel" ? "cancelled" : "superseded",
		});
	});
	test("conflicts changed nested arguments and denies replay after snapshot revocation", async () => {
		const f = await fixture();
		await f.a.mutation(api.proposals.submitProposal, { request: f.request });
		expect(
			await errorOf(
				f.a.mutation(api.proposals.submitProposal, {
					request: {
						...f.request,
						proposal: {
							...f.proposal,
							claims: [
								{ ...f.proposal.claims[0], statement: "Changed nested text" },
							],
						},
					},
				}),
			),
		).toMatchObject({ code: "request_key_conflict" });
		await f.t.run(async (ctx) => {
			const grants = await ctx.db.query("grants").collect();
			const row = grants.find((g) => g.resourceKind === "snapshot");
			if (!row) throw new Error("Missing fixture grant");
			await ctx.db.patch(row._id, { revokedAt: Date.now() });
		});
		expect(
			await errorOf(
				f.a.mutation(api.proposals.submitProposal, { request: f.request }),
			),
		).toEqual(forbidden);
	});
	test("authorizes changed nested references before revealing a receipt conflict", async () => {
		const f = await fixture();
		await f.a.mutation(api.proposals.submitProposal, { request: f.request });
		const proposal = {
			...f.proposal,
			claims: [
				{
					...f.proposal.claims[0],
					refs: [{ ...f.evidence.ref, snapshotId: "foreign-snapshot" }],
				},
			],
		};
		expect(
			await errorOf(
				f.a.mutation(api.proposals.submitProposal, {
					request: { ...f.request, proposal },
				}),
			),
		).toEqual(forbidden);
	});
	test.each([
		"outside",
		"missing-entry",
	] as const)("rejects %s source reference", async (kind) => {
		const f = await fixture();
		const before = await state(f);
		await f.t.run((ctx) =>
			ctx.db.insert("grants", {
				principal: identity(PRINCIPAL_A).tokenIdentifier,
				resourceKind: "snapshot",
				resourceId: "outside-snapshot",
				role: "owner",
				epoch: 1,
			}),
		);
		const ref = {
			...f.evidence.ref,
			...(kind === "outside"
				? { snapshotId: "outside-snapshot" }
				: { entryId: "missing-entry" }),
		};
		const proposal = {
			...f.proposal,
			claims: [{ ...f.proposal.claims[0], refs: [ref] }],
		};
		expect(
			await errorOf(
				f.a.mutation(api.proposals.submitProposal, {
					request: { ...f.request, proposal },
				}),
			),
		).toEqual(
			kind === "outside"
				? forbidden
				: {
						code: "source_unavailable",
						message: "Source entry is unavailable",
					},
		);
		expect(await state(f)).toEqual(before);
	});
	test.each([
		"actor",
		"owner",
		"principal",
		"token",
	])("rejects smuggled %s at all request depths", async (field) => {
		const f = await fixture();
		const before = await state(f);
		const payloads = [
			{ ...f.request, [field]: "forged" },
			{ ...f.request, proposal: { ...f.proposal, [field]: "forged" } },
			{
				...f.request,
				proposal: {
					...f.proposal,
					claims: [
						{
							...f.proposal.claims[0],
							refs: [{ ...f.evidence.ref, [field]: "forged" }],
						},
					],
				},
			},
		];
		for (const request of payloads)
			expect(
				await errorOf(f.a.mutation(api.proposals.submitProposal, { request })),
			).toMatchObject({ code: "invalid_request" });
		expect(await state(f)).toEqual(before);
	});
	test.each([
		"composition",
		"unknowns",
		"long-summary",
		"oversized",
		"deep",
	] as const)("rejects %s without partial writes", async (kind) => {
		const f = await fixture();
		const before = await state(f);
		let request: unknown = f.request;
		if (kind === "composition")
			request = {
				...f.request,
				proposal: {
					...f.proposal,
					composition: {
						catalogVersion: "1",
						root: {
							component: "Stack",
							children: [
								{
									component: "EvidencePair",
									left: f.evidence.ref,
									right: f.evidence.ref,
								},
							],
						},
					},
				},
			};
		if (kind === "unknowns")
			request = {
				...f.request,
				proposal: {
					...f.proposal,
					claims: [
						{ ...f.proposal.claims[0], unknowns: ["Unresolved limitation"] },
					],
				},
			};
		if (kind === "long-summary" || kind === "oversized")
			request = {
				...f.request,
				proposal: {
					...f.proposal,
					claims: [
						{
							...f.proposal.claims[0],
							statement: "x".repeat(kind === "long-summary" ? 513 : 140000),
						},
					],
				},
			};
		if (kind === "deep") {
			for (let i = 0; i < 80; i++) request = { nested: request };
		}
		expect(
			await errorOf(f.a.mutation(api.proposals.submitProposal, { request })),
		).toMatchObject({
			code:
				kind === "composition" || kind === "unknowns"
					? "unsupported"
					: kind === "long-summary"
						? "limit_exceeded"
						: "invalid_request",
		});
		expect(await state(f)).toEqual(before);
	});
	test("a racing human correction survives either publication ordering", async () => {
		const f = await fixture();
		const outcomes = await Promise.allSettled([
			f.a.mutation(api.proposals.submitProposal, { request: f.request }),
			f.a.mutation(api.decisions.recordDecision, {
				request: {
					investigationId: f.investigation.investigationId,
					expectedRevision: 0,
					kind: "correction",
					statement: "Racing correction is durable",
					requestKey: "racing-correction",
				},
			}),
		]);
		expect(outcomes[1].status).toBe("fulfilled");
		const current = await f.a.query(api.investigations.readInvestigation, {
			request: { investigationId: f.investigation.investigationId },
		});
		expect(current).toMatchObject({
			revision: 1,
			decisions: [{ statement: "Racing correction is durable" }],
		});
		expect(current.acceptedFindings?.length ?? 0).toBe(
			outcomes[0].status === "fulfilled" ? 1 : 0,
		);
		const run = await f.a.query(api.runs.getRun, {
			request: { runId: f.run.runId },
		});
		expect(["published", "superseded"]).toContain(run.status);
	});
});
