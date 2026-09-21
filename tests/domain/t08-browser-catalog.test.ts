// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import {
	type ClaimCatalog,
	createCatalogSession,
} from "../../src/integrations/convex/catalog-session";

const modules = import.meta.glob("../../convex/**/*.ts");
test("browser session deduplicates real claims and never retries revoked access automatically", async () => {
	const t = convexTest(schema, modules);
	const ownerTokenIdentifier = "https://operator.example|owner";
	await t.mutation(internal.operatorProvisioning.registerSnapshot, {
		ownerTokenIdentifier,
		input: {
			project: {
				repositoryId: "shared",
				displayName: "Shared demo",
				provider: "local-git",
				dataLabel: "public",
				syncStatus: "ready",
				snapshots: [
					{
						snapshotId: "shared-snapshot",
						commit: "a".repeat(40),
						rootTreeId: "b".repeat(40),
						hashAlgorithm: "sha1",
						indexedAt: 1,
						coverage: "not_indexed",
					},
				],
			},
			entries: [],
		},
	});
	await t.mutation(internal.operatorProvisioning.setDemoCatalog, {
		ownerTokenIdentifier,
		input: { snapshotId: "shared-snapshot", enabled: true },
	});
	const caller = t.withIdentity({
		issuer: "https://users.example",
		subject: "browser",
		tokenIdentifier: "https://users.example|browser",
	});
	const requests: Parameters<ClaimCatalog>[0][] = [];
	const invoke: ClaimCatalog = (args) => {
		requests.push(args);
		return caller.mutation(api.catalog.claimDemoAccess, args);
	};
	const session = createCatalogSession();
	await Promise.all([session.claim(invoke), session.claim(invoke)]);
	expect(requests).toHaveLength(1);
	expect(Object.keys(requests[0].request)).toEqual(["requestKey"]);
	expect(
		(await caller.query(api.projects.listProjects, { request: {} })).entries,
	).toHaveLength(1);
	expect(await t.run((ctx) => ctx.db.query("receipts").collect())).toHaveLength(
		1,
	);
	await t.run(async (ctx) => {
		const grant = await ctx.db
			.query("grants")
			.withIndex("by_principal_resource", (q) =>
				q
					.eq("principal", "https://users.example|browser")
					.eq("resourceKind", "snapshot")
					.eq("resourceId", "shared-snapshot"),
			)
			.unique();
		if (!grant) throw new Error("Missing fixture grant");
		await ctx.db.patch(grant._id, { revokedAt: Date.now() });
	});
	await session.claim(invoke);
	expect(requests).toHaveLength(1);
	expect(
		(await caller.query(api.projects.listProjects, { request: {} })).entries,
	).toEqual([]);
	session.retry();
	await expect(session.claim(invoke)).rejects.toMatchObject({
		data: { code: "not_found" },
	});
	await expect(session.claim(invoke)).rejects.toMatchObject({
		data: { code: "not_found" },
	});
	expect(requests).toHaveLength(2);
	expect(requests[1]).toEqual(requests[0]);
});
