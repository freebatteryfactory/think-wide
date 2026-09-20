// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { OPERATION_LIMITS, SEARCH_CAPS } from "../../core/limits";
import { CONTRACT_VERSION } from "../../generated/operations";
import { Capabilities } from "../../generated/validators.js";
import { PRINCIPAL_A } from "../fixtures/identities";

const modules = import.meta.glob("../../convex/**/*.ts");
function client() {
	return convexTest(schema, modules).withIdentity({
		issuer: PRINCIPAL_A.issuer,
		subject: PRINCIPAL_A.subject,
		tokenIdentifier: `${PRINCIPAL_A.issuer}|${PRINCIPAL_A.subject}`,
	});
}
afterEach(() => vi.unstubAllEnvs());

describe("capabilities through the real operation pipeline", () => {
	test.each([
		"local-demo",
		"connected",
	] as const)("%s reports its profile and shared limits without claiming deployment", async (mode) => {
		vi.stubEnv("THINK_WIDE_MODE", mode);
		const result = await client().query(api.capabilities.getCapabilities, {
			request: {},
		});
		expect(Capabilities(result)).toBe(true);
		expect(result).toEqual({
			contractVersion: CONTRACT_VERSION,
			mode,
			authProfile:
				mode === "connected" ? "workos-authkit" : "local-fixed-principal",
			searchModes: [],
			limits: {
				searchHitsPerPage: SEARCH_CAPS.hitsPerPage,
				treeChildrenPerPage: OPERATION_LIMITS.treeChildrenPerPage,
				resultTextBytes: OPERATION_LIMITS.resultBytes,
				exactWindowBytes: OPERATION_LIMITS.exactWindowBytes,
				scanMaxFiles: SEARCH_CAPS.maxFiles,
				scanMaxBytes: SEARCH_CAPS.maxScanBytes,
				scanMaxMs: SEARCH_CAPS.wallClockMs,
			},
			integrations: {
				hostedIdentity: mode === "connected" ? "local_only" : "not_run",
				remoteMcp: "not_run",
				githubApp: "not_run",
				issuePublish: "disabled",
				backendReasoning: "disabled",
				outcomeIngestion: "disabled",
			},
		});
	});
	test.each([
		undefined,
		"",
		"production",
	])("unknown mode %s fails closed", async (mode) => {
		vi.stubEnv("THINK_WIDE_MODE", mode);
		await expect(
			client().query(api.capabilities.getCapabilities, { request: {} }),
		).rejects.toMatchObject({ data: { code: "capability_disabled" } });
	});
	test.each([
		"local-demo",
		"connected",
	])("%s still requires a verified identity", async (mode) => {
		vi.stubEnv("THINK_WIDE_MODE", mode);
		await expect(
			convexTest(schema, modules).query(api.capabilities.getCapabilities, {
				request: {},
			}),
		).rejects.toMatchObject({ data: { code: "unauthenticated" } });
	});
	test("connected requests cannot smuggle an identity", async () => {
		vi.stubEnv("THINK_WIDE_MODE", "connected");
		await expect(
			client().query(api.capabilities.getCapabilities, {
				request: { owner: PRINCIPAL_A.subject },
			}),
		).rejects.toMatchObject({ data: { code: "invalid_request" } });
	});
});
