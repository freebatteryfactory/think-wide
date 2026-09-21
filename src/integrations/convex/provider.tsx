import { ConvexQueryClient } from "@convex-dev/react-query";
import { useAuth } from "@workos/authkit-tanstack-react-start/client";
import { ConvexProvider, ConvexProviderWithAuth } from "convex/react";
import { browserIdentityMode } from "../../lib/identity-mode";
import { useWorkOSConvexAuth } from "../workos/convex-auth";
import { CatalogSessionProvider } from "./catalog-session";

// Vite inlines VITE_* at BUILD time. A production image built without this variable used to
// throw while this module loaded (`new ConvexQueryClient(undefined)`), which turned every page,
// including the ones that never touch the backend, into an HTTP 500.
const CONVEX_URL: string | undefined = import.meta.env.VITE_CONVEX_URL;

/** False when the build has no backend URL. Routes that need the backend must check this. */
export const backendConfigured = Boolean(CONVEX_URL);

const convexQueryClient = CONVEX_URL
	? new ConvexQueryClient(CONVEX_URL)
	: undefined;

if (!convexQueryClient) {
	console.error(
		"VITE_CONVEX_URL was not set when this bundle was built: pages that need the backend will say so; static pages still render.",
	);
}

export default function AppConvexProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	if (!convexQueryClient) {
		return <>{children}</>;
	}
	if (browserIdentityMode === "workos") {
		// I01: the signed-in person's own access token reaches Convex through the adapter.
		// Requires AuthKitProvider above this component (src/integrations/workos/provider.tsx).
		return <WorkOSConvexProvider>{children}</WorkOSConvexProvider>;
	}
	// Identity mode "none": exactly what main shipped before I01. No token is ever requested,
	// so every handler answers `unauthenticated`.
	return (
		<ConvexProvider client={convexQueryClient.convexClient}>
			{children}
		</ConvexProvider>
	);
}

function WorkOSConvexProvider({ children }: { children: React.ReactNode }) {
	const { user } = useAuth();
	if (!convexQueryClient) {
		return <>{children}</>;
	}
	// This key only resets UI/auth state. Convex still verifies the token before
	// isAuthenticated becomes true; user IDs are never operation arguments.
	return (
		<ConvexProviderWithAuth
			key={user?.id ?? "signed-out"}
			client={convexQueryClient.convexClient}
			useAuth={useWorkOSConvexAuth}
		>
			<CatalogSessionProvider>{children}</CatalogSessionProvider>
		</ConvexProviderWithAuth>
	);
}
