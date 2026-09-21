/// <reference types="node" />
import type { AuthConfig } from "convex/server";

const local = process.env.THINK_WIDE_MODE === "local-demo";
// Convex evaluates bundles with NODE_ENV=production even on the local backend.
// Local trust is an explicit deployment setting; the Node issuer independently
// refuses production and can send tokens only to a literal loopback backend.
if (
	local &&
	!process.env.THINK_WIDE_LOCAL_JWKS?.startsWith(
		"data:text/plain;charset=utf-8;base64,",
	)
) {
	throw new Error("Local identity requires its public JWKS data URI");
}
// I01: WorkOS AuthKit browser-session profile. Values observed from a real
// decoded staging token on 2026-09-20, not copied from documentation:
//   iss = https://api.workos.com/user_management/<clientId>   alg = RS256
//   aud = ABSENT, so applicationID cannot be set for this profile.
// Convex warns that skipping the audience check is unsafe when the issuer is
// shared between applications. This issuer embeds our own client id, so a token
// minted for any other WorkOS application carries a different iss and is
// rejected by the exact issuer match. Without a client id we trust nothing.
const workosClientId = process.env.WORKOS_CLIENT_ID;
const workos = workosClientId
	? [
			{
				type: "customJwt" as const,
				issuer: `https://api.workos.com/user_management/${workosClientId}`,
				jwks: `https://api.workos.com/sso/jwks/${workosClientId}`,
				algorithm: "RS256" as const,
			},
		]
	: [];

function mcpProviders(): AuthConfig["providers"] {
	// Read only in connected mode. An empty issuer explicitly disables this profile;
	// Convex deployments must set the variable before evaluating this configuration.
	if (process.env.THINK_WIDE_MODE !== "connected") return [];
	const configured = process.env.MCP_AUTHORIZATION_SERVER;
	if (!configured) return [];
	const issuer = new URL(configured);
	if (issuer.protocol !== "https:" || configured !== issuer.origin) {
		throw new Error("MCP_AUTHORIZATION_SERVER must be an HTTPS origin");
	}
	const resource = process.env.MCP_RESOURCE_URL;
	if (!resource) throw new Error("MCP_RESOURCE_URL is required for MCP OAuth");
	const audience = new URL(resource);
	if (
		audience.protocol !== "https:" ||
		audience.username ||
		audience.password ||
		audience.search ||
		audience.hash ||
		audience.pathname !== "/api/mcp" ||
		audience.href !== resource
	) {
		throw new Error("MCP_RESOURCE_URL must be a canonical HTTPS /api/mcp URL");
	}
	return [
		{
			type: "customJwt",
			issuer: issuer.origin,
			jwks: new URL("/oauth2/jwks", issuer).href,
			algorithm: "RS256",
			// Convex 1.46 verifies aud against applicationID. Never substitute the WorkOS
			// environment/client id: that token is not bound to this MCP resource.
			applicationID: resource,
		},
	];
}
export default {
	providers: local
		? [
				{
					type: "customJwt",
					applicationID: "think-wide-local",
					issuer: "http://127.0.0.1/think-wide-local",
					jwks: process.env.THINK_WIDE_LOCAL_JWKS!,
					algorithm: "RS256",
				},
			]
		: [...workos, ...mcpProviders()],
} satisfies AuthConfig;
