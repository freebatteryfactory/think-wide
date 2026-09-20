import {
	useAccessToken,
	useAuth,
} from "@workos/authkit-tanstack-react-start/client";
import { useCallback, useMemo } from "react";

/** The exact `useAuth` contract of `ConvexProviderWithAuth` (convex/react, ConvexAuthState.d.ts). */
export type ConvexAuthAdapter = {
	isLoading: boolean;
	isAuthenticated: boolean;
	fetchAccessToken: (args: {
		forceRefreshToken: boolean;
	}) => Promise<string | null>;
};

/**
 * I01: hands the signed-in person's WorkOS access token to the browser's Convex client.
 *
 * - The token is the user's own, obtained by the AuthKit client through its server functions
 *   from the encrypted session cookie. This hook never sees a refresh token, an API key or
 *   the cookie password, and it never logs the token.
 * - `isAuthenticated` here only means "AuthKit has a user". Convex still verifies signature,
 *   issuer and expiry itself (convex/auth.config.ts) before any handler sees an identity.
 * - Signed out, or any failure to obtain a token, resolves `null`: Convex then runs
 *   unauthenticated and every handler answers `unauthenticated`. Nothing falls back to
 *   another principal.
 * - `fetchAccessToken` must keep its identity between renders: `ConvexProviderWithAuth`
 *   re-runs `client.setAuth` whenever it changes. It depends on the user id (a different
 *   person must re-authenticate the socket) and on the AuthKit callbacks, which are stable.
 */
export function useWorkOSConvexAuth(): ConvexAuthAdapter {
	const { user, loading } = useAuth();
	const { getAccessToken, refresh } = useAccessToken();
	const userId = user?.id;

	const fetchAccessToken = useCallback(
		async ({
			forceRefreshToken,
		}: {
			forceRefreshToken: boolean;
		}): Promise<string | null> => {
			if (!userId) {
				return null;
			}
			try {
				// Convex sets forceRefreshToken after the backend rejected the current token:
				// `refresh()` always asks the server for a new one, `getAccessToken()` reuses
				// the cached token unless it is close to `exp`.
				const token = forceRefreshToken
					? await refresh()
					: await getAccessToken();
				return token ?? null;
			} catch {
				console.error(
					"Could not obtain an access token from the AuthKit session; continuing signed out.",
				);
				return null;
			}
		},
		[userId, getAccessToken, refresh],
	);

	return useMemo(
		() => ({
			isLoading: loading,
			isAuthenticated: Boolean(userId),
			fetchAccessToken,
		}),
		[loading, userId, fetchAccessToken],
	);
}
