import { ConvexQueryClient } from "@convex-dev/react-query";
import { ConvexProvider } from "convex/react";

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
	return (
		<ConvexProvider client={convexQueryClient.convexClient}>
			{children}
		</ConvexProvider>
	);
}
