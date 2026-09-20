import { createFileRoute } from "@tanstack/react-router";
import { handleOperation } from "../../server/http";

export const Route = createFileRoute("/api/ops/$operationId")({
	server: {
		handlers: {
			ANY: ({ request, params }) =>
				handleOperation(request, params.operationId),
		},
	},
});
