// I01: which identity integration this build and this server use.
//
// Two switches, both explicit, both defaulting to "none":
//   VITE_THINK_WIDE_IDENTITY  build time, inlined into the browser bundle. It only selects
//                             which React providers mount. It is a mode NAME, never a
//                             credential: no token, key, principal or secret goes in VITE_*.
//   THINK_WIDE_IDENTITY       server runtime (src/start.ts, src/routes/api/auth/*). Decides
//                             whether the AuthKit request middleware is installed at all.
//
// "none" is what main shipped before I01: a bare Convex provider, every handler answers
// `unauthenticated`, and the UI shows its sign-in / unavailable states. Neither switch can
// grant anything: authorization is decided inside Convex from a verified token only.

export type IdentityMode = "workos" | "none";

/** Anything other than the exact string "workos" is "none". There is no permissive default. */
export function parseIdentityMode(raw: string | undefined): IdentityMode {
	return raw === "workos" ? "workos" : "none";
}

const BUILD_VALUE: string | undefined = import.meta.env
	.VITE_THINK_WIDE_IDENTITY;

/** Identity mode compiled into this bundle. */
export const browserIdentityMode: IdentityMode = parseIdentityMode(BUILD_VALUE);
