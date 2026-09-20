import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { OPERATION_LIMITS } from "../../core/limits";
import { canonicalArguments } from "../../core/receipts";
import { OPERATIONS } from "../../generated/operations";
import type { OperationError } from "../../generated/types";
import { OperationError as isOperationError } from "../../generated/validators.js";
import {
	mcpIssuer,
	verifyMcpToken,
	verifySessionToken,
	workosIssuer,
} from "./auth/verify-token";
import { serverConfig } from "./config";
import { createMcpServer } from "./mcp/server";
import { dispatch } from "./ops/dispatch";

const noStore = { "Cache-Control": "no-store" };
function errorResponse(
	code: OperationError["code"],
	message: string,
	status: number,
	headers?: HeadersInit,
) {
	return Response.json({ code, message } satisfies OperationError, {
		status,
		headers: { ...noStore, ...headers },
	});
}

function resourceConfig() {
	if (serverConfig().mode !== "connected") {
		throw new Error("HTTP requires connected mode");
	}
	const resource = new URL(process.env.MCP_RESOURCE_URL ?? "");
	if (
		resource.protocol !== "https:" ||
		resource.username ||
		resource.password ||
		resource.search ||
		resource.hash
	) {
		throw new Error("MCP_RESOURCE_URL must be HTTPS");
	}
	return { resource };
}

function checkOrigin(request: Request, resource: URL) {
	const url = new URL(request.url);
	const origin = request.headers.get("origin");
	const host = request.headers.get("host");
	return (
		// The private app receives HTTP after Caddy terminates TLS. Validate the
		// configured authority, never trust forwarded headers to select an origin.
		url.host === resource.host &&
		(!host || host === resource.host) &&
		(!origin || origin === resource.origin)
	);
}

/** Advertise only the explicitly configured OAuth authorization server. */
export function protectedResourceMetadata(request: Request): Response {
	try {
		const { resource } = resourceConfig();
		if (!checkOrigin(request, resource)) {
			return errorResponse("not_found", "Resource not found", 403);
		}
		return Response.json(
			{
				resource: resource.href,
				authorization_servers: [mcpIssuer()],
				bearer_methods_supported: ["header"],
			},
			{ headers: noStore },
		);
	} catch {
		return errorResponse(
			"capability_disabled",
			"HTTP transport is not configured",
			503,
		);
	}
}

function challenge(resource: URL, profile: "session" | "mcp") {
	if (profile === "session") {
		return { "WWW-Authenticate": 'Bearer realm="think-wide-browser-api"' };
	}
	const metadata = new URL("/.well-known/oauth-protected-resource", resource);
	return { "WWW-Authenticate": `Bearer resource_metadata="${metadata.href}"` };
}

async function authenticate(
	request: Request,
	profile: "session" | "mcp",
): Promise<string | Response> {
	let resource: URL;
	try {
		({ resource } = resourceConfig());
		if (profile === "mcp") {
			mcpIssuer();
		} else {
			workosIssuer();
		}
	} catch {
		return errorResponse(
			"capability_disabled",
			"HTTP transport is not configured",
			503,
		);
	}
	if (!checkOrigin(request, resource)) {
		return errorResponse("not_found", "Resource not found", 403);
	}
	try {
		return profile === "mcp"
			? await verifyMcpToken(request, resource.href)
			: await verifySessionToken(request, resource.href);
	} catch {
		return errorResponse(
			"unauthenticated",
			"Authentication required",
			401,
			challenge(resource, profile),
		);
	}
}

/** Bound the actual byte stream, not a caller-controlled Content-Length. */
async function readJson(request: Request): Promise<unknown> {
	if (
		request.headers
			.get("content-type")
			?.split(";", 1)[0]
			.trim()
			.toLowerCase() !== "application/json"
	) {
		throw new Error("Expected JSON");
	}
	const reader = request.body?.getReader();
	if (!reader) {
		throw new Error("Missing body");
	}
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) {
				break;
			}
			length += value.byteLength;
			if (length > OPERATION_LIMITS.requestBytes) {
				await reader.cancel();
				throw new Error("Request too large");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	const body: unknown = JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(bytes),
	);
	canonicalArguments(body);
	return body;
}

function invalidJson() {
	return Response.json(
		{
			code: "invalid_request",
			message: "Invalid JSON request",
			details: [{ path: "/request", problem: "Expected bounded JSON request" }],
		} satisfies OperationError,
		{ status: 400, headers: noStore },
	);
}

export async function handleOperation(
	request: Request,
	operationId: string,
): Promise<Response> {
	const token = await authenticate(request, "session");
	if (token instanceof Response) {
		return token;
	}
	if (request.method !== "POST") {
		return new Response(null, {
			status: 405,
			headers: { ...noStore, Allow: "POST" },
		});
	}
	const definition = OPERATIONS.find(
		(entry) => entry.operationId === operationId,
	);
	if (
		!definition ||
		!definition.exposure.some((surface) => surface === "http")
	) {
		return errorResponse("capability_disabled", "Operation unavailable", 404);
	}
	let body: unknown;
	try {
		body = await readJson(request);
	} catch {
		return invalidJson();
	}
	const result = await dispatch(definition.operationId, body, token);
	const code = isOperationError(result)
		? (result as OperationError).code
		: undefined;
	const status =
		code === undefined
			? 200
			: code === "not_found"
				? 404
				: code === "unauthenticated"
					? 401
					: code === "internal"
						? 500
						: code === "revision_conflict" || code === "request_key_conflict"
							? 409
							: 400;
	return Response.json(result, {
		status,
		headers: {
			...noStore,
			...(status === 401
				? challenge(resourceConfig().resource, "session")
				: {}),
		},
	});
}

export async function handleMcp(request: Request): Promise<Response> {
	const token = await authenticate(request, "mcp");
	if (token instanceof Response) {
		return token;
	}
	// Stateless request/response transport: no resumable GET stream or sessions.
	if (request.method !== "POST") {
		return new Response(null, {
			status: 405,
			headers: { ...noStore, Allow: "POST" },
		});
	}
	let body: unknown;
	try {
		body = await readJson(request);
		if (Array.isArray(body)) {
			throw new Error("Batch requests are unsupported");
		}
	} catch {
		return invalidJson();
	}
	const server = createMcpServer(async () => token);
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
	});
	try {
		await server.connect(transport);
		const response = await transport.handleRequest(request, {
			parsedBody: body,
		});
		response.headers.set("Cache-Control", "no-store");
		return response;
	} finally {
		await server.close();
	}
}
