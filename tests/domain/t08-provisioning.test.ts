// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { MCP_TOOL_NAMES } from "../../generated/mcp-tools";
import { OPERATION_HANDLERS } from "../../generated/operations";

const modules = import.meta.glob("../../convex/**/*.ts");
const recipient = "http://127.0.0.1/think-wide-local|local-developer";
const entries = [
	internal.operatorProvisioning.registerSnapshot,
	internal.operatorProvisioning.cacheSource,
	internal.operatorProvisioning.cacheHistory,
] as const;

describe("operator provisioning boundary", () => {
	test.each([
		"user_01example",
		"",
		"https://issuer.example|",
		"https://issuer.example|a|b",
		"https://issuer.example|a b",
		"https://issuer.example|a\nb",
		"http://external.example|user",
		"https://user:password@issuer.example|subject",
		"https://issuer.example?x=1|subject",
		"https://issuer.example#fragment|subject",
		`https://issuer.example|${"x".repeat(2048)}`,
	])("rejects malformed recipient %j before touching storage", async (ownerTokenIdentifier) => {
		const t = convexTest(schema, modules);
		await expect(
			t.mutation(internal.operatorProvisioning.registerSnapshot, {
				ownerTokenIdentifier,
				input: { project: {}, entries: [] },
			}),
		).rejects.toMatchObject({
			data: {
				code: "invalid_request",
				details: [{ path: "/ownerTokenIdentifier" }],
			},
		});
		expect(
			await t.run(
				async (ctx) => (await ctx.db.query("snapshots").collect()).length,
			),
		).toBe(0);
		expect(
			await t.run(
				async (ctx) => (await ctx.db.query("grants").collect()).length,
			),
		).toBe(0);
	});

	test("rejects user context even when an internal caller has the reference", async () => {
		const t = convexTest(schema, modules).withIdentity({
			tokenIdentifier: recipient,
		});
		await expect(
			t.mutation(entries[0], {
				ownerTokenIdentifier: recipient,
				input: { project: {}, entries: [] },
			}),
		).rejects.toMatchObject({ data: { code: "not_found" } });
		await expect(
			t.mutation(entries[1], {
				ownerTokenIdentifier: recipient,
				input: {
					snapshotId: "missing",
					entryId: "missing",
					bytes: new ArrayBuffer(0),
				},
			}),
		).rejects.toMatchObject({ data: { code: "not_found" } });
		await expect(
			t.mutation(entries[2], {
				ownerTokenIdentifier: recipient,
				input: { snapshotId: "missing", records: [], complete: true },
			}),
		).rejects.toMatchObject({ data: { code: "not_found" } });
	});

	test("has no operation binding or MCP tool", () => {
		expect(JSON.stringify(OPERATION_HANDLERS)).not.toContain(
			"operatorProvisioning",
		);
		expect(
			MCP_TOOL_NAMES.some((name) =>
				/provision|registerSnapshot|cacheSource|cacheHistory/i.test(name),
			),
		).toBe(false);
	});
});
