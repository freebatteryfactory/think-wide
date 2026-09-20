import { createRemoteJWKSet, jwtVerify } from "jose";

let cached:
	| { clientId: string; keys: ReturnType<typeof createRemoteJWKSet> }
	| undefined;

export function workosIssuer() {
	const clientId = process.env.WORKOS_CLIENT_ID;
	if (!clientId || !/^client_[A-Za-z0-9]+$/.test(clientId)) {
		throw new Error("WORKOS_CLIENT_ID is required");
	}
	return {
		clientId,
		issuer: `https://api.workos.com/user_management/${clientId}`,
	};
}

/** Verify the existing AuthKit browser session profile. Its client-specific issuer and
 * JWKS bind the application; observed WorkOS session JWTs have no aud claim.
 * This is not yet resource-audience-bound OAuth for third-party MCP hosts. */
export async function verifySessionToken(
	request: Request,
	resource: string,
): Promise<string> {
	const token = bearerToken(request);
	const { clientId, issuer } = workosIssuer();
	if (cached?.clientId !== clientId) {
		cached = {
			clientId,
			keys: createRemoteJWKSet(
				new URL(`https://api.workos.com/sso/jwks/${clientId}`),
			),
		};
	}
	const { payload } = await jwtVerify(token, cached.keys, {
		issuer,
		algorithms: ["RS256"],
		requiredClaims: ["iss", "sub", "iat", "exp"],
	});
	if (
		!payload.sub ||
		(payload.client_id !== undefined && payload.client_id !== clientId)
	) {
		throw new Error("Authentication required");
	}
	// Never ignore an audience if the provider starts issuing one.
	if (
		payload.aud !== undefined &&
		!(Array.isArray(payload.aud) ? payload.aud : [payload.aud]).includes(
			resource,
		)
	) {
		throw new Error("Authentication required");
	}
	return token;
}

function bearerToken(request: Request): string {
	const match = request.headers
		.get("authorization")
		?.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i);
	if (!match || match[1].length > 16384) {
		throw new Error("Authentication required");
	}
	return match[1];
}

/** No default issuer: operator configuration follows a verified OAuth flow. */
export function mcpIssuer(): string {
	const configured = process.env.MCP_AUTHORIZATION_SERVER;
	if (!configured) {
		throw new Error("MCP OAuth is not configured");
	}
	const url = new URL(configured);
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname !== "/" ||
		configured !== url.origin
	) {
		throw new Error("MCP authorization server must be an HTTPS origin");
	}
	return url.origin;
}

let mcpCached:
	| { issuer: string; keys: ReturnType<typeof createRemoteJWKSet> }
	| undefined;

/** OAuth access tokens are a different profile from AuthKit browser sessions.
 * Preserve the original token and issuer: downstream Convex verifies it again. */
export async function verifyMcpToken(
	request: Request,
	resource: string,
): Promise<string> {
	const token = bearerToken(request);
	const issuer = mcpIssuer();
	if (mcpCached?.issuer !== issuer) {
		mcpCached = {
			issuer,
			keys: createRemoteJWKSet(new URL("/oauth2/jwks", issuer)),
		};
	}
	const { payload } = await jwtVerify(token, mcpCached.keys, {
		issuer,
		audience: resource,
		algorithms: ["RS256"],
		requiredClaims: ["iss", "sub", "iat", "exp", "aud"],
	});
	if (!payload.sub) {
		throw new Error("Authentication required");
	}
	return token;
}
