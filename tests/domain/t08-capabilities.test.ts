// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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
beforeEach(() => {
	vi.stubEnv("THINK_WIDE_EVIDENCE_HOSTED_IDENTITY", undefined);
	vi.stubEnv("THINK_WIDE_EVIDENCE_REMOTE_MCP", undefined);
	vi.stubEnv("MCP_AUTHORIZATION_SERVER", undefined);
});
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
				hostedIdentity: "not_run",
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

describe("deployment-specific attested integration evidence", () => {
	test.each([
		"not_run",
		"disabled",
		"local_only",
		"live",
	] as const)("accepts generated CapabilityStatus %s on this connected deployment", async (status) => {
		vi.stubEnv("THINK_WIDE_MODE", "connected");
		vi.stubEnv("THINK_WIDE_EVIDENCE_HOSTED_IDENTITY", status);
		vi.stubEnv("THINK_WIDE_EVIDENCE_REMOTE_MCP", status);
		const response = await client().query(api.capabilities.getCapabilities, {
			request: {},
		});
		expect(response.integrations).toEqual({
			hostedIdentity: status,
			remoteMcp: status,
			githubApp: "not_run",
			issuePublish: "disabled",
			backendReasoning: "disabled",
			outcomeIngestion: "disabled",
		});
		expect(response.searchModes).toEqual([]);
		expect(response.contractVersion).toBe(CONTRACT_VERSION);
	});
	test.each([
		"",
		"deployed",
		"LIVE",
		" live ",
		"true",
	])("invalid configured status %s fails generated response validation", async (status) => {
		vi.stubEnv("THINK_WIDE_MODE", "connected");
		vi.stubEnv("THINK_WIDE_EVIDENCE_REMOTE_MCP", status);
		await expect(
			client().query(api.capabilities.getCapabilities, { request: {} }),
		).rejects.toMatchObject({
			data: { code: "internal", message: "Invalid operation response" },
		});
	});
	test("local-demo cannot inherit connected deployment evidence", async () => {
		vi.stubEnv("THINK_WIDE_MODE", "local-demo");
		vi.stubEnv("THINK_WIDE_EVIDENCE_HOSTED_IDENTITY", "live");
		vi.stubEnv("THINK_WIDE_EVIDENCE_REMOTE_MCP", "live");
		const response = await client().query(api.capabilities.getCapabilities, {
			request: {},
		});
		expect(response.integrations.hostedIdentity).toBe("not_run");
		expect(response.integrations.remoteMcp).toBe("not_run");
	});
	test.each([
		true,
		false,
	])("profile follows verified issuer, MCP=%s", async (mcp) => {
		vi.stubEnv("THINK_WIDE_MODE", "connected");
		vi.stubEnv("MCP_AUTHORIZATION_SERVER", "https://auth.example");
		const issuer = mcp
			? "https://auth.example"
			: "https://auth.example.attacker.invalid";
		const t = convexTest(schema, modules).withIdentity({
			issuer,
			subject: "same-user",
			tokenIdentifier: `${issuer}|same-user`,
		});
		const response = await t.query(api.capabilities.getCapabilities, {
			request: {},
		});
		expect(response.authProfile).toBe(
			mcp ? "workos-mcp-resource" : "workos-authkit",
		);
	});
	test("request arguments cannot set attested statuses or a caller profile", async () => {
		vi.stubEnv("THINK_WIDE_MODE", "connected");
		await expect(
			client().query(api.capabilities.getCapabilities, {
				request: {
					hostedIdentity: "live",
					remoteMcp: "live",
					authProfile: "workos-mcp-resource",
				},
			}),
		).rejects.toMatchObject({ data: { code: "invalid_request" } });
	});
});
