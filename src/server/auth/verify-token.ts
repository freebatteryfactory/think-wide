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

/** Verify the existing AuthKit session profile. Its client-specific issuer and
 * JWKS bind the application; observed WorkOS session JWTs have no aud claim.
 * This is not yet resource-audience-bound OAuth for third-party MCP hosts. */
export async function verifyToken(
	request: Request,
	resource: string,
): Promise<string> {
	const authorization = request.headers.get("authorization");
	const match = authorization?.match(
		/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i,
	);
	if (!match || match[1].length > 16384) {
		throw new Error("Authentication required");
	}
	const token = match[1];
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
