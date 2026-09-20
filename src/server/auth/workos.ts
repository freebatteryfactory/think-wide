import {
	browserIdentityMode,
	type IdentityMode,
	parseIdentityMode,
} from "../../lib/identity-mode";

// I01: server-side switch for the WorkOS AuthKit integration. Trusted Node only: nothing
// under src/components or src/routes (except src/routes/api/**) may import this file.
//
// This module holds no credential. WORKOS_API_KEY and WORKOS_COOKIE_PASSWORD are read from
// the process environment by the AuthKit package itself, never by application code.

let mismatchReported = false;

/** "workos" only when the server process was started with THINK_WIDE_IDENTITY=workos. */
export function serverIdentityMode(): IdentityMode {
	const mode = parseIdentityMode(process.env.THINK_WIDE_IDENTITY);
	if (mode !== browserIdentityMode && !mismatchReported) {
		mismatchReported = true;
		console.error(
			`Identity mode mismatch: server THINK_WIDE_IDENTITY is "${mode}" but this bundle was built with VITE_THINK_WIDE_IDENTITY "${browserIdentityMode}". Sign-in will not work until they agree.`,
		);
	}
	return mode;
}

/**
 * The AuthKit routes exist in every build. When the server is not in WorkOS mode the
 * AuthKit middleware is not installed, so they answer 404 instead of failing with a 500.
 */
export function identityRouteUnavailable(): Response | undefined {
	if (serverIdentityMode() === "workos") {
		return undefined;
	}
	return new Response("Sign-in is not configured on this deployment.\n", {
		status: 404,
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
}
