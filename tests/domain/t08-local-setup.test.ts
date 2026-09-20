// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import {
	type Ingest,
	seedLocalFixtures,
} from "../../scripts/lib/local-fixtures";
import { ALPHA_TS } from "../fixtures/repos/cases";

const modules = import.meta.glob("../../convex/**/*.ts");

describe("local demo fixture ingestion through real handlers", () => {
	test("replays without duplicate rows and preserves exact source and scoped grants", async () => {
		const t = convexTest(schema, modules);
		const owner = t.withIdentity({
			issuer: "local-test",
			subject: "owner",
			tokenIdentifier: "local-test|owner",
		});
		const seed = async () => {
			const existing = await owner.query(api.projects.listProjects, {
				request: {},
			});
			return seedLocalFixtures(
				owner.mutation.bind(owner) as Ingest,
				existing.entries as import("../../generated/types").Project[],
			);
		};
		const first = await seed();
		const counts = () =>
			t.run(async (ctx) => ({
				snapshots: (await ctx.db.query("snapshots").collect()).length,
				entries: (await ctx.db.query("entries").collect()).length,
				grants: (await ctx.db.query("grants").collect()).length,
				cache: (await ctx.db.query("sourceCache").collect()).length,
				history: (await ctx.db.query("historyCache").collect()).length,
			}));
		const before = await counts();
		expect(await seed()).toEqual(first);
		expect(await counts()).toEqual(before);
		expect(before).toMatchObject({ snapshots: 2, grants: 2, history: 2 });
		const projects = await owner.query(api.projects.listProjects, {
			request: {},
		});
		expect(projects.entries).toHaveLength(2);
		const snapshotId = first[0].snapshotId;
		const entry = await t.run(async (ctx) =>
			(await ctx.db.query("entries").collect()).find(
				(row) =>
					row.snapshotId === snapshotId &&
					JSON.parse(row.body).displayPath === "src/alpha.ts",
			),
		);
		if (!entry) throw new Error("Expected fixture source");
		const source = await owner.query(api.sourceCache.readSource, {
			request: { snapshotId, entryId: entry.entryId },
		});
		expect(source.content).toBe(ALPHA_TS);
		await expect(
			t
				.withIdentity({ tokenIdentifier: "other|user" })
				.query(api.sourceCache.readSource, {
					request: { snapshotId, entryId: entry.entryId },
				}),
		).rejects.toMatchObject({ data: { code: "not_found" } });
		await t.run(async (ctx) => {
			const grant = (await ctx.db.query("grants").collect()).find(
				(row) => row.resourceId === snapshotId,
			);
			if (!grant) throw new Error("Expected owner grant");
			await ctx.db.patch(grant._id, { revokedAt: Date.now() });
		});
		await expect(seed()).rejects.toMatchObject({ data: { code: "not_found" } });
		expect(await counts()).toEqual(before);
	}, 30000);
});
