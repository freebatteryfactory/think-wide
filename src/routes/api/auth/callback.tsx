import { createFileRoute } from "@tanstack/react-router";
import { handleCallbackRoute } from "@workos/authkit-tanstack-react-start";
import { identityRouteUnavailable } from "../../../server/auth/workos";

const handleCallback = handleCallbackRoute();

export const Route = createFileRoute("/api/auth/callback")({
	server: {
		handlers: {
			GET: async ({ request }) =>
				identityRouteUnavailable() ?? handleCallback({ request }),
		},
	},
});
