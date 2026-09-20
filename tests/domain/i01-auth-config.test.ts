import { beforeEach, describe, expect, test, vi } from "vitest";

// I01: convex/auth.config.ts decides which token issuers the Convex deployment trusts. It
// reads the DEPLOYMENT's environment at module load, so each case sets the environment and
// loads a fresh copy of the unmodified file. No network: the module only builds an object.
// This proves provider SELECTION. That a Convex backend accepts a real WorkOS token with
// this configuration: NOT RUN here (docs/evidence/I01.md).

const LOCAL_JWKS = `data:text/plain;charset=utf-8;base64,${Buffer.from(
	JSON.stringify({ keys: [] }),
).toString("base64")}`;
const CLIENT_ID = "client_TESTONLY0000000000000000";

type Provider = Record<string, unknown>;

async function providers(env: {
	mode?: string;
	localJwks?: string;
	workosClientId?: string;
}): Promise<Provider[]> {
	vi.resetModules();
	vi.stubEnv("THINK_WIDE_MODE", env.mode as string);
	vi.stubEnv("THINK_WIDE_LOCAL_JWKS", env.localJwks as string);
	vi.stubEnv("WORKOS_CLIENT_ID", env.workosClientId as string);
	const module = await import("../../convex/auth.config");
	return module.default.providers as Provider[];
}

beforeEach(() => {
	vi.unstubAllEnvs();
});

describe("convex/auth.config.ts provider selection", () => {
	test("local-demo trusts exactly the local issuer, even when a WorkOS client id is present", async () => {
		for (const workosClientId of [undefined, CLIENT_ID]) {
			const list = await providers({
				mode: "local-demo",
				localJwks: LOCAL_JWKS,
				workosClientId,
			});
			expect(list).toEqual([
				{
					type: "customJwt",
					applicationID: "think-wide-local",
					issuer: "http://127.0.0.1/think-wide-local",
					jwks: LOCAL_JWKS,
					algorithm: "RS256",
				},
			]);
			expect(JSON.stringify(list)).not.toContain("workos");
		}
	});

	test("local-demo without its JWKS data URI refuses to load", async () => {
		await expect(providers({ mode: "local-demo" })).rejects.toThrow(
			"Local identity requires its public JWKS data URI",
		);
		await expect(
			providers({
				mode: "local-demo",
				localJwks: "https://example.invalid/jwks.json",
			}),
		).rejects.toThrow("Local identity requires its public JWKS data URI");
	});

	test("a WorkOS client id without local-demo trusts exactly the WorkOS issuer, with no applicationID", async () => {
		for (const mode of [undefined, "connected"]) {
			const list = await providers({ mode, workosClientId: CLIENT_ID });
			expect(list).toEqual([
				{
					type: "customJwt",
					issuer: `https://api.workos.com/user_management/${CLIENT_ID}`,
					jwks: `https://api.workos.com/sso/jwks/${CLIENT_ID}`,
					algorithm: "RS256",
				},
			]);
			// A real decoded staging token has no `aud` claim (reasoning is in the file).
			expect(list[0]).not.toHaveProperty("applicationID");
			expect(JSON.stringify(list)).not.toContain("think-wide-local");
		}
	});

	test("a leftover local JWKS is ignored outside local-demo", async () => {
		const list = await providers({
			mode: "connected",
			localJwks: LOCAL_JWKS,
			workosClientId: CLIENT_ID,
		});
		expect(list).toHaveLength(1);
		expect(list[0]?.issuer).toBe(
			`https://api.workos.com/user_management/${CLIENT_ID}`,
		);
	});

	test("neither: nothing is trusted", async () => {
		expect(await providers({})).toEqual([]);
		expect(await providers({ mode: "connected" })).toEqual([]);
		expect(await providers({ mode: "connected", workosClientId: "" })).toEqual(
			[],
		);
	});
});
