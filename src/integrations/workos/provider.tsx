import { AuthKitProvider } from "@workos/authkit-tanstack-react-start/client";
import { browserIdentityMode } from "../../lib/identity-mode";

export default function AppWorkOSProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	// Identity mode "none": AuthKitProvider is not mounted, so the browser never calls the
	// AuthKit server functions of a deployment that has no WorkOS configuration.
	if (browserIdentityMode !== "workos") {
		return <>{children}</>;
	}
	return <AuthKitProvider>{children}</AuthKitProvider>;
}
