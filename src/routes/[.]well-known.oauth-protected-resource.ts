import { createFileRoute } from "@tanstack/react-router";
import { protectedResourceMetadata } from "../server/http";

export const Route = createFileRoute("/.well-known/oauth-protected-resource")({
	server: {
		handlers: { GET: ({ request }) => protectedResourceMetadata(request) },
	},
});
