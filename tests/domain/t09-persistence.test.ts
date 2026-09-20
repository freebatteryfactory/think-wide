// @vitest-environment edge-runtime
import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import { afterAll, beforeAll, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import type {
	HandoffBodyWindow,
	HandoffRead,
	Project,
} from "../../generated/types";
import { readHandoffExport } from "../../src/components/behavior/handoff-export";
import { verifySourceEvidence } from "../../src/components/behavior/source-evidence";
import { type GitSnapshot, openSnapshot } from "../../src/server/git/snapshot";
import { bundlePath } from "../fixtures/repos/cases";

const modules = import.meta.glob("../../convex/**/*.ts");
const identity = {
	tokenIdentifier: "test|t09",
	issuer: "test",
	subject: "t09",
};
const snapshots: GitSnapshot[] = [];
beforeAll(async () => {
	for (const name of ["alpha", "beta"] as const) {
		snapshots.push(
			await openSnapshot({ repositoryId: name, bundlePath: bundlePath(name) }),
		);
	}
});
afterAll(async () => {
	for (const snapshot of snapshots) {
		await snapshot.close();
	}
});

async function setup() {
	const t = convexTest(schema, modules);
	const actor = t.withIdentity(identity);
	const refs = [];
	for (const snapshot of snapshots) {
		const project: Project = {
			repositoryId: snapshot.repositoryId,
			displayName: "Synthetic fixture",
			provider: "local-git",
			syncStatus: "ready",
			dataLabel: "synthetic",
			snapshots: [snapshot.summary],
		};
		await actor.mutation(internal.snapshots.register, {
			project,
			entries: snapshot.entries,
		});
		const entry = snapshot.entries.find(
			(candidate) =>
				candidate.displayPath ===
				(snapshot.repositoryId === "alpha" ? "src/alpha.ts" : "lib/beta.ts"),
		);
		if (!entry) {
			throw new Error("Fixture entry missing");
		}
		const request = {
			snapshotId: snapshot.summary.snapshotId,
			entryId: entry.entryId,
		};
		await actor.mutation(internal.sourceCache.put, {
			...request,
			bytes: Uint8Array.from(await snapshot.blob(entry.entryId)).buffer,
		});
		const evidence = await actor.query(api.sourceCache.readSource, { request });
		refs.push(
			(
				await verifySourceEvidence(
					evidence,
					request.snapshotId,
					request.entryId,
				)
			).ref,
		);
	}
	const investigation = await actor.mutation(
		api.investigations.openInvestigation,
		{
			request: {
				snapshotIds: snapshots.map((s) => s.summary.snapshotId),
				question: "Compare exact sources",
				requestKey: "open-t09",
			},
		},
	);
	for (const [index, ref] of refs.entries()) {
		await actor.mutation(api.decisions.recordDecision, {
			request: {
				investigationId: investigation.investigationId,
				expectedRevision: index,
				kind: index ? "correction" : "rejection",
				category: "security",
				statement: index
					? "Preserve exact UTF-8 bytes.\r\n"
					: "Never execute target code.",
				refs: [ref],
				requestKey: `decision-${index}`,
			},
		});
	}
	const request = {
		investigationId: investigation.investigationId,
		expectedRevision: 2,
		targetRepositoryId: "alpha",
		audience: "private_download" as const,
		requestKey: "prepare-t09",
	};
	return { t, actor, request, refs };
}

test("two real Git snapshots feed a durable exact brief; reread and replay survive newer decisions", async () => {
	const { t, actor, request, refs } = await setup();
	const saved = await actor.mutation(api.handoffs.prepareHandoff, { request });
	const read = await t.withIdentity(identity).query(api.handoffs.readHandoff, {
		request: { handoffId: saved.handoffId, handoffRevision: 1 },
	});
	if (!("bodyMarkdown" in read)) {
		throw new Error("Expected complete brief");
	}
	expect(read.targetRepository.baseCommit).toBe(snapshots[0].summary.commit);
	expect(read.targetRepository.hashAlgorithm).toBe(
		snapshots[0].summary.hashAlgorithm,
	);
	expect(read.constraints.map((c) => [c.kind, c.category])).toEqual([
		["rejected_approach", "security"],
		["correction", "security"],
	]);
	expect(read.evidence.map((e) => e.ref)).toEqual(expect.arrayContaining(refs));
	expect(read.bodyHash).toBe(
		createHash("sha256").update(read.bodyMarkdown).digest("hex"),
	);
	await actor.mutation(api.decisions.recordDecision, {
		request: {
			investigationId: request.investigationId,
			expectedRevision: 2,
			kind: "constraint",
			statement: "Later direction must not rewrite the saved brief",
			requestKey: "later-decision",
		},
	});
	expect(
		await actor.mutation(api.handoffs.prepareHandoff, { request }),
	).toEqual(saved);
	expect(
		await actor.query(api.handoffs.readHandoff, {
			request: { handoffId: saved.handoffId },
		}),
	).toEqual(read);
	const rows = await t.run(async (ctx) => ({
		handoffs: await ctx.db.query("handoffs").collect(),
		receipts: await ctx.db.query("receipts").collect(),
	}));
	expect(rows.handoffs).toHaveLength(1);
	expect(
		rows.receipts.find((r) => r.operationId === "prepareHandoff"),
	).toMatchObject({ resultKind: "handoff", resultId: saved.handoffId });
	expect(rows.receipts.every((r) => !("body" in r) && !("response" in r))).toBe(
		true,
	);
	await expect(
		actor.mutation(api.handoffs.prepareHandoff, {
			request: { ...request, targetRepositoryId: "beta" },
		}),
	).rejects.toThrow("different arguments");
});

test("missing and foreign briefs are indistinguishable; snapshot revocation denies reads and replay", async () => {
	const { t, actor, request } = await setup();
	const saved = await actor.mutation(api.handoffs.prepareHandoff, { request });
	const firstWindow = await actor.query(api.handoffs.readHandoff, {
		request: {
			handoffId: saved.handoffId,
			handoffRevision: 1,
			detail: "body",
			byteRange: { start: 0, end: saved.bodyByteLength },
		},
	});
	expect("content" in firstWindow).toBe(true);
	const stranger = t.withIdentity({
		issuer: "test",
		subject: "stranger",
		tokenIdentifier: "test|stranger",
	});
	for (const id of [saved.handoffId, "missing"]) {
		await expect(
			stranger.query(api.handoffs.readHandoff, { request: { handoffId: id } }),
		).rejects.toThrow("Resource not found");
	}
	await t.run(async (ctx) => {
		const grants = await ctx.db.query("grants").collect();
		const grant = grants.find((g) => g.resourceKind === "snapshot");
		if (!grant) {
			throw new Error("Missing grant");
		}
		await ctx.db.patch(grant._id, { revokedAt: 1 });
	});
	await expect(
		actor.query(api.handoffs.readHandoff, {
			request: {
				handoffId: saved.handoffId,
				detail: "body",
				handoffRevision: 1,
				byteRange: { start: 0, end: saved.bodyByteLength },
			},
		}),
	).rejects.toThrow("Resource not found");
	await expect(
		actor.mutation(api.handoffs.prepareHandoff, { request }),
	).rejects.toThrow("Resource not found");
});

test("stale revisions, public audiences and reader mutations leave no brief or receipt", async () => {
	const { t, actor, request } = await setup();
	await expect(
		actor.mutation(api.handoffs.prepareHandoff, {
			request: { ...request, expectedRevision: 1 },
		}),
	).rejects.toThrow("revision changed");
	await expect(
		actor.mutation(api.handoffs.prepareHandoff, {
			request: { ...request, audience: "public_issue" },
		}),
	).rejects.toThrow("publication is unavailable");
	await t.run(async (ctx) => {
		const grants = await ctx.db.query("grants").collect();
		const grant = grants.find((g) => g.resourceKind === "investigation");
		if (!grant) {
			throw new Error("Missing grant");
		}
		await ctx.db.patch(grant._id, { role: "reader" });
	});
	await expect(
		actor.mutation(api.handoffs.prepareHandoff, { request }),
	).rejects.toThrow("Resource not found");
	expect(await t.run((ctx) => ctx.db.query("handoffs").collect())).toHaveLength(
		0,
	);
	expect(
		(await t.run((ctx) => ctx.db.query("receipts").collect())).some(
			(r) => r.operationId === "prepareHandoff",
		),
	).toBe(false);
});

test("an indexed ref with a fabricated digest cannot be frozen; cache eviction denies saved reads", async () => {
	const { t, actor, request, refs } = await setup();
	const saved = await actor.mutation(api.handoffs.prepareHandoff, { request });
	await actor.mutation(api.decisions.recordDecision, {
		request: {
			investigationId: request.investigationId,
			expectedRevision: 2,
			kind: "constraint",
			statement: "Fabricated digest",
			refs: [{ ...refs[0], digest: "0".repeat(64) }],
			requestKey: "bad-digest",
		},
	});
	await expect(
		actor.mutation(api.handoffs.prepareHandoff, {
			request: { ...request, expectedRevision: 3, requestKey: "bad-brief" },
		}),
	).rejects.toThrow("Frozen evidence is unavailable");
	expect(await t.run((ctx) => ctx.db.query("handoffs").collect())).toHaveLength(
		1,
	);
	await t.run(async (ctx) => {
		for (const row of await ctx.db.query("sourceCache").collect()) {
			await ctx.db.delete(row._id);
		}
	});
	await expect(
		actor.query(api.handoffs.readHandoff, {
			request: { handoffId: saved.handoffId },
		}),
	).rejects.toThrow("Source bytes are unavailable");
});

test("briefs larger than the response cap reassemble exactly from bounded UTF-8 windows", async () => {
	const { actor, request } = await setup();
	await actor.mutation(api.decisions.recordDecision, {
		request: {
			investigationId: request.investigationId,
			expectedRevision: 2,
			kind: "acceptance",
			statement: "Café 東京\r\n".repeat(750),
			requestKey: "large-decision",
		},
	});
	const saved = await actor.mutation(api.handoffs.prepareHandoff, {
		request: { ...request, expectedRevision: 3 },
	});
	expect(saved.bodyByteLength).toBeGreaterThan(16384);
	await expect(
		actor.query(api.handoffs.readHandoff, {
			request: { handoffId: saved.handoffId },
		}),
	).rejects.toThrow("16 KiB");
	let range: HandoffBodyWindow["nextRange"] = {
		start: 0,
		end: saved.bodyByteLength,
	};
	let body = "";
	let calls = 0;
	while (range) {
		const page: HandoffRead = await actor.query(api.handoffs.readHandoff, {
			request: {
				handoffId: saved.handoffId,
				handoffRevision: 1,
				detail: "body",
				byteRange: range,
			},
		});
		if (!("content" in page)) {
			throw new Error("Expected body window");
		}
		expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(16384);
		expect(page.byteRange.start).toBe(Buffer.byteLength(body));
		expect(Buffer.byteLength(page.content)).toBe(
			page.byteRange.end - page.byteRange.start,
		);
		body += page.content;
		range = page.nextRange;
		if (++calls > 128) {
			throw new Error("Unbounded pagination");
		}
	}
	expect(Buffer.byteLength(body)).toBe(saved.bodyByteLength);
	expect(
		(
			await readHandoffExport(saved, (request) =>
				actor.query(api.handoffs.readHandoff, { request }),
			)
		).bodyMarkdown,
	).toBe(body);
	expect(createHash("sha256").update(body).digest("hex")).toBe(saved.bodyHash);
	expect(body).toContain(JSON.stringify("Café 東京\r\n".repeat(750)));
	await expect(
		actor.query(api.handoffs.readHandoff, {
			request: {
				handoffId: saved.handoffId,
				handoffRevision: 2,
				detail: "summary",
			},
		}),
	).rejects.toThrow("Resource not found");
	await expect(
		actor.query(api.handoffs.readHandoff, {
			request: {
				handoffId: saved.handoffId,
				handoffRevision: 1,
				detail: "body",
				byteRange: { start: 5, end: 2 },
			},
		}),
	).rejects.toThrow("valid UTF-8 body range");
});
