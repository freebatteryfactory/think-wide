import { createFileRoute } from "@tanstack/react-router";
import { getSignInUrl } from "@workos/authkit-tanstack-react-start";
import { identityRouteUnavailable } from "../../../server/auth/workos";

export const Route = createFileRoute("/api/auth/sign-in")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const unavailable = identityRouteUnavailable();
				if (unavailable) {
					return unavailable;
				}
				const returnPathname = new URL(request.url).searchParams.get(
					"returnPathname",
				);
				const url = await getSignInUrl(
					returnPathname ? { data: { returnPathname } } : undefined,
				);

				return new Response(null, {
					status: 307,
					headers: { Location: url },
				});
			},
		},
	},
});
