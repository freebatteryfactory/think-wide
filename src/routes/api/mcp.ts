import { createFileRoute } from "@tanstack/react-router";
import { handleMcp } from "../../server/http";

export const Route = createFileRoute("/api/mcp")({
	server: { handlers: { ANY: ({ request }) => handleMcp(request) } },
});
