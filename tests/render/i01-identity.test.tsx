import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

// I01. The ONLY thing mocked here is the AuthKit browser client: whether AuthKit reports a
// user, and the two token functions. Convex authorization is never mocked and never
// consulted: these tests prove what the browser hands to Convex, not that Convex accepts it.
// Real browser login and Convex token acceptance: NOT RUN here (docs/evidence/I01.md).

const FAKE_TOKEN = "header.payload-not-a-real-token.signature";
const REFRESHED = "header.refreshed-not-a-real-token.signature";

const authkit = vi.hoisted(() => ({
	useAuth: vi.fn(),
	useAccessToken: vi.fn(),
	providerRenders: { count: 0 },
}));

vi.mock("@workos/authkit-tanstack-react-start/client", () => ({
	useAuth: authkit.useAuth,
	useAccessToken: authkit.useAccessToken,
	AuthKitProvider: ({ children }: { children: ReactNode }) => {
		authkit.providerRenders.count += 1;
		return <div data-authkit-provider="">{children}</div>;
	},
}));

const getAccessToken = vi.fn<() => Promise<string | undefined>>();
const refresh = vi.fn<() => Promise<string | undefined>>();
const signOut = vi.fn<() => Promise<void>>();

function authkitReports(state: {
	user: { id: string; email: string } | null;
	loading?: boolean;
}) {
	authkit.useAuth.mockImplementation(() => ({
		user: state.user,
		loading: state.loading ?? false,
		signOut,
	}));
	authkit.useAccessToken.mockImplementation(() => ({
		accessToken: undefined,
		loading: false,
		error: null,
		getAccessToken,
		refresh,
	}));
}

const PERSON = { id: "user_01TESTONLY", email: "person@example.test" };

async function build(env: { identity?: string; convexUrl?: string }) {
	vi.resetModules();
	// vi.stubEnv writes import.meta.env, which is what Vite inlines at build time.
	vi.stubEnv("VITE_THINK_WIDE_IDENTITY", env.identity as string);
	vi.stubEnv("VITE_CONVEX_URL", env.convexUrl as string);
	const convexReact = await import("convex/react");
	const convexProvider = await import("../../src/integrations/convex/provider");
	const workosProvider = await import("../../src/integrations/workos/provider");
	const adapter = await import("../../src/integrations/workos/convex-auth");
	const indicator = await import("../../src/components/shell/AuthIndicator");
	return { convexReact, convexProvider, workosProvider, adapter, indicator };
}

// `.invalid` never resolves (RFC 2606) and a static server render runs no effects, so no
// connection is attempted. This is NOT the local demo backend.
const BACKEND = "https://backend.invalid";

beforeEach(() => {
	vi.unstubAllEnvs();
	authkit.providerRenders.count = 0;
	getAccessToken.mockReset();
	refresh.mockReset();
	signOut.mockReset();
	authkit.useAuth.mockReset();
	authkit.useAccessToken.mockReset();
	// Any unexpected call to AuthKit fails loudly instead of returning undefined.
	authkit.useAuth.mockImplementation(() => {
		throw new Error("useAuth must not be called in this mode");
	});
	authkit.useAccessToken.mockImplementation(() => {
		throw new Error("useAccessToken must not be called in this mode");
	});
});

describe("identity mode parsing", () => {
	test("only the exact string 'workos' enables WorkOS; everything else is 'none'", async () => {
		const { parseIdentityMode } = await import("../../src/lib/identity-mode");
		expect(parseIdentityMode("workos")).toBe("workos");
		for (const raw of [
			undefined,
			"",
			"none",
			"WorkOS",
			" workos",
			"true",
			"1",
		]) {
			expect(parseIdentityMode(raw)).toBe("none");
		}
	});

	test("the bundle default is 'none'", async () => {
		vi.resetModules();
		const { browserIdentityMode } = await import("../../src/lib/identity-mode");
		expect(browserIdentityMode).toBe("none");
	});
});

describe("mode none: exactly the pre-I01 behavior", () => {
	test("bare ConvexProvider, no auth context, and AuthKit is never touched", async () => {
		const { convexReact, convexProvider, workosProvider } = await build({
			identity: "none",
			convexUrl: BACKEND,
		});
		const seen: { client?: unknown } = {};
		function Probe() {
			seen.client = convexReact.useConvex();
			return <p>child</p>;
		}
		function AuthStateProbe() {
			convexReact.useConvexAuth();
			return null;
		}
		const AppWorkOSProvider = workosProvider.default;
		const AppConvexProvider = convexProvider.default;
		const html = renderToStaticMarkup(
			<AppWorkOSProvider>
				<AppConvexProvider>
					<Probe />
				</AppConvexProvider>
			</AppWorkOSProvider>,
		);
		// There is no Convex auth state at all: the provider is the bare one.
		expect(() =>
			renderToStaticMarkup(
				<AppConvexProvider>
					<AuthStateProbe />
				</AppConvexProvider>,
			),
		).toThrow("ConvexProviderWithAuth");
		expect(html).toBe("<p>child</p>");
		expect(convexProvider.backendConfigured).toBe(true);
		expect(seen.client).toBeDefined();
		expect(authkit.providerRenders.count).toBe(0);
		expect(authkit.useAuth).not.toHaveBeenCalled();
		expect(authkit.useAccessToken).not.toHaveBeenCalled();
		expect(getAccessToken).not.toHaveBeenCalled();
		expect(refresh).not.toHaveBeenCalled();
	});

	test("an unset variable is mode none", async () => {
		const { convexReact, convexProvider } = await build({
			convexUrl: BACKEND,
		});
		function AuthStateProbe() {
			convexReact.useConvexAuth();
			return null;
		}
		const AppConvexProvider = convexProvider.default;
		expect(() =>
			renderToStaticMarkup(
				<AppConvexProvider>
					<AuthStateProbe />
				</AppConvexProvider>,
			),
		).toThrow("ConvexProviderWithAuth");
		expect(authkit.useAuth).not.toHaveBeenCalled();
	});

	test("the nav affordance renders nothing and does not read AuthKit", async () => {
		const { indicator } = await build({
			identity: "none",
			convexUrl: BACKEND,
		});
		expect(renderToStaticMarkup(<indicator.AuthIndicator />)).toBe("");
		expect(authkit.useAuth).not.toHaveBeenCalled();
	});
});

describe("no backend URL: still graceful in both modes", () => {
	for (const identity of ["none", "workos"]) {
		test(`mode ${identity} renders children without a Convex client and without throwing`, async () => {
			const complaint = vi.spyOn(console, "error").mockImplementation(() => {});
			const { convexProvider } = await build({ identity });
			const AppConvexProvider = convexProvider.default;
			const html = renderToStaticMarkup(
				<AppConvexProvider>
					<p>static page</p>
				</AppConvexProvider>,
			);
			expect(html).toBe("<p>static page</p>");
			expect(convexProvider.backendConfigured).toBe(false);
			expect(complaint).toHaveBeenCalledWith(
				expect.stringContaining("VITE_CONVEX_URL was not set"),
			);
			expect(authkit.useAuth).not.toHaveBeenCalled();
			expect(getAccessToken).not.toHaveBeenCalled();
		});
	}
});

describe("mode workos: the Convex client is given the AuthKit adapter", () => {
	test("AuthKitProvider wraps ConvexProviderWithAuth, which exposes an auth state", async () => {
		authkitReports({ user: null });
		const { convexReact, convexProvider, workosProvider } = await build({
			identity: "workos",
			convexUrl: BACKEND,
		});
		let state: { isLoading: boolean; isAuthenticated: boolean } | undefined;
		function Probe() {
			state = convexReact.useConvexAuth();
			return <p>child</p>;
		}
		const AppWorkOSProvider = workosProvider.default;
		const AppConvexProvider = convexProvider.default;
		const html = renderToStaticMarkup(
			<AppWorkOSProvider>
				<AppConvexProvider>
					<Probe />
				</AppConvexProvider>
			</AppWorkOSProvider>,
		);
		expect(html).toBe('<div data-authkit-provider=""><p>child</p></div>');
		expect(authkit.providerRenders.count).toBe(1);
		expect(authkit.useAuth).toHaveBeenCalled();
		// Convex never reports authenticated on the say-so of the auth provider alone.
		expect(state?.isAuthenticated).toBe(false);
		// Rendering must not fetch a token; Convex asks for one from an effect, in a browser.
		expect(getAccessToken).not.toHaveBeenCalled();
		expect(refresh).not.toHaveBeenCalled();
	});
});

describe("useWorkOSConvexAuth adapter", () => {
	async function capture() {
		const { adapter } = await build({
			identity: "workos",
			convexUrl: BACKEND,
		});
		let captured: ReturnType<typeof adapter.useWorkOSConvexAuth> | undefined;
		function Probe() {
			captured = adapter.useWorkOSConvexAuth();
			return null;
		}
		renderToStaticMarkup(<Probe />);
		if (!captured) {
			throw new Error("adapter did not render");
		}
		return captured;
	}

	test("signed out: not authenticated, and fetchAccessToken resolves null without asking AuthKit", async () => {
		authkitReports({ user: null });
		const auth = await capture();
		expect(auth.isLoading).toBe(false);
		expect(auth.isAuthenticated).toBe(false);
		await expect(
			auth.fetchAccessToken({ forceRefreshToken: false }),
		).resolves.toBeNull();
		await expect(
			auth.fetchAccessToken({ forceRefreshToken: true }),
		).resolves.toBeNull();
		expect(getAccessToken).not.toHaveBeenCalled();
		expect(refresh).not.toHaveBeenCalled();
	});

	test("while AuthKit is still resolving the session it reports loading, not signed in", async () => {
		authkitReports({ user: null, loading: true });
		const auth = await capture();
		expect(auth.isLoading).toBe(true);
		expect(auth.isAuthenticated).toBe(false);
	});

	test("signed in: returns the AuthKit token unchanged; forceRefreshToken false uses the cached path", async () => {
		authkitReports({ user: PERSON });
		getAccessToken.mockResolvedValue(FAKE_TOKEN);
		refresh.mockResolvedValue(REFRESHED);
		const auth = await capture();
		expect(auth.isAuthenticated).toBe(true);
		await expect(
			auth.fetchAccessToken({ forceRefreshToken: false }),
		).resolves.toBe(FAKE_TOKEN);
		expect(getAccessToken).toHaveBeenCalledTimes(1);
		expect(refresh).not.toHaveBeenCalled();
	});

	test("signed in: forceRefreshToken true asks AuthKit for a NEW token and never the cached one", async () => {
		authkitReports({ user: PERSON });
		getAccessToken.mockResolvedValue(FAKE_TOKEN);
		refresh.mockResolvedValue(REFRESHED);
		const auth = await capture();
		await expect(
			auth.fetchAccessToken({ forceRefreshToken: true }),
		).resolves.toBe(REFRESHED);
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(getAccessToken).not.toHaveBeenCalled();
	});

	test("AuthKit has a user but no token: null, never a substitute", async () => {
		authkitReports({ user: PERSON });
		getAccessToken.mockResolvedValue(undefined);
		refresh.mockResolvedValue(undefined);
		const auth = await capture();
		await expect(
			auth.fetchAccessToken({ forceRefreshToken: false }),
		).resolves.toBeNull();
		await expect(
			auth.fetchAccessToken({ forceRefreshToken: true }),
		).resolves.toBeNull();
	});

	test("a failed refresh resolves null and the log line carries no token or error detail", async () => {
		authkitReports({ user: PERSON });
		refresh.mockRejectedValue(new Error(`upstream said ${FAKE_TOKEN}`));
		const complaint = vi.spyOn(console, "error").mockImplementation(() => {});
		const auth = await capture();
		await expect(
			auth.fetchAccessToken({ forceRefreshToken: true }),
		).resolves.toBeNull();
		expect(complaint).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(complaint.mock.calls)).not.toContain(FAKE_TOKEN);
	});
});

describe("AuthIndicator in mode workos", () => {
	test("signed out: a plain link to the AuthKit sign-in route, no user text", async () => {
		authkitReports({ user: null });
		const { indicator } = await build({
			identity: "workos",
			convexUrl: BACKEND,
		});
		const html = renderToStaticMarkup(<indicator.AuthIndicator />);
		expect(html).toContain('href="/api/auth/sign-in"');
		expect(html).toContain("Sign in");
		expect(html).not.toContain("Sign out");
		expect(html).not.toContain("@");
	});

	test("signed in: the session's email and a sign-out button, no sign-in link", async () => {
		authkitReports({ user: PERSON });
		const { indicator } = await build({
			identity: "workos",
			convexUrl: BACKEND,
		});
		const html = renderToStaticMarkup(<indicator.AuthIndicator />);
		expect(html).toContain(PERSON.email);
		expect(html).toContain("Sign out");
		expect(html).toContain('type="button"');
		expect(html).not.toContain("/api/auth/sign-in");
		// The access token is never rendered.
		expect(authkit.useAccessToken).not.toHaveBeenCalled();
	});

	test("while loading it claims neither state", async () => {
		authkitReports({ user: null, loading: true });
		const { indicator } = await build({
			identity: "workos",
			convexUrl: BACKEND,
		});
		const html = renderToStaticMarkup(<indicator.AuthIndicator />);
		expect(html).not.toContain("Sign in<");
		expect(html).not.toContain("Sign out");
	});
});

describe("server identity switch (src/server/auth/workos.ts)", () => {
	async function server(runtime: string | undefined, built?: string) {
		vi.resetModules();
		vi.stubEnv("VITE_THINK_WIDE_IDENTITY", built as string);
		vi.stubEnv("THINK_WIDE_IDENTITY", runtime as string);
		return import("../../src/server/auth/workos");
	}

	test("unset or anything but 'workos': AuthKit routes answer 404, not 500", async () => {
		for (const runtime of [undefined, "", "none", "WORKOS"]) {
			const { serverIdentityMode, identityRouteUnavailable } =
				await server(runtime);
			expect(serverIdentityMode()).toBe("none");
			const response = identityRouteUnavailable();
			expect(response?.status).toBe(404);
		}
	});

	test("'workos' lets the AuthKit routes run", async () => {
		const { serverIdentityMode, identityRouteUnavailable } = await server(
			"workos",
			"workos",
		);
		expect(serverIdentityMode()).toBe("workos");
		expect(identityRouteUnavailable()).toBeUndefined();
	});

	test("a build/runtime disagreement is reported once, by name only", async () => {
		const complaint = vi.spyOn(console, "error").mockImplementation(() => {});
		const { serverIdentityMode } = await server("workos", "none");
		serverIdentityMode();
		serverIdentityMode();
		expect(complaint).toHaveBeenCalledTimes(1);
		expect(String(complaint.mock.calls[0]?.[0])).toContain(
			"Identity mode mismatch",
		);
	});
});
