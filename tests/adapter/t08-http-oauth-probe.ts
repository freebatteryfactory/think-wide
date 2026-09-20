/** Explicit live acceptance, not a fixture suite. OAuth secrets stay in memory. */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import {
	auth,
	discoverAuthorizationServerMetadata,
	type OAuthClientProvider,
	type OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
	OAuthClientInformationMixed,
	OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { MCP_TOOL_NAMES } from "../../generated/mcp-tools";
import { mcpIssuer, workosIssuer } from "../../src/server/auth/verify-token";

const callback = "http://127.0.0.1:3183/callback";
const state = randomBytes(32).toString("base64url");
const fingerprint = (value: string) =>
	createHash("sha256").update(value).digest("hex");

async function main() {
	if (process.argv.slice(2).some((arg) => arg !== "--call-mcp"))
		throw new Error("Unknown probe argument");
	const issuer = mcpIssuer();
	const resource = new URL(process.env.MCP_RESOURCE_URL ?? "");
	if (
		resource.protocol !== "https:" ||
		resource.username ||
		resource.password ||
		resource.search ||
		resource.hash
	)
		throw new Error("Expected HTTPS resource");
	const controller = new AbortController();
	const boundedFetch: typeof fetch = (input, init) =>
		fetch(input, {
			...init,
			signal: AbortSignal.any([
				controller.signal,
				AbortSignal.timeout(10_000),
				...(init?.signal ? [init.signal] : []),
			]),
		});
	const metadata = await discoverAuthorizationServerMetadata(issuer, {
		fetchFn: boundedFetch,
	});
	if (
		!metadata ||
		metadata.issuer !== issuer ||
		metadata.jwks_uri !== new URL("/oauth2/jwks", issuer).href ||
		!metadata.code_challenge_methods_supported?.includes("S256")
	)
		throw new Error("Unexpected authorization server discovery");
	for (const endpoint of [
		metadata.authorization_endpoint,
		metadata.token_endpoint,
		metadata.registration_endpoint,
	]) {
		if (endpoint && new URL(endpoint).origin !== issuer)
			throw new Error("Unexpected OAuth endpoint authority");
	}
	// This profile probe can precede deployment. SDK-supported out-of-band
	// discovery state names the intended resource; it does not claim that the
	// MCP application's own discovery endpoint was reached.
	let discovery: OAuthDiscoveryState = {
		authorizationServerUrl: issuer,
		authorizationServerMetadata: metadata,
		resourceMetadata: {
			resource: resource.href,
			authorization_servers: [issuer],
			bearer_methods_supported: ["header"],
		},
	};
	let clientInfo: OAuthClientInformationMixed | undefined;
	if (process.env.MCP_PROBE_CLIENT_ID)
		clientInfo = { client_id: process.env.MCP_PROBE_CLIENT_ID };
	if (!clientInfo && !metadata.registration_endpoint) {
		console.error(
			"Prerequisite missing: discovery does not advertise DCR. Enable it in Connect or set MCP_PROBE_CLIENT_ID for a registered public client.",
		);
		throw new Error("DCR unavailable");
	}
	let tokens: OAuthTokens | undefined;
	let verifier: string | undefined;
	let receiveCode: (code: string) => void = () => {
		throw new Error("Callback not initialized");
	};
	const codePromise = new Promise<string>((resolve) => {
		receiveCode = resolve;
	});
	let received = false;
	const listener = createServer((request, response) => {
		response.setHeader("Cache-Control", "no-store");
		response.setHeader("Referrer-Policy", "no-referrer");
		const url = new URL(request.url ?? "/", callback);
		const providedState = Buffer.from(url.searchParams.get("state") ?? "");
		const expectedState = Buffer.from(state);
		const code = url.searchParams.get("code");
		if (
			request.method !== "GET" ||
			request.headers.host !== "127.0.0.1:3183" ||
			url.pathname !== "/callback" ||
			received ||
			!code ||
			code.length > 8192 ||
			providedState.length !== expectedState.length ||
			!timingSafeEqual(providedState, expectedState)
		) {
			response.writeHead(400).end("OAuth callback rejected");
			return;
		}
		received = true;
		response
			.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" })
			.end(
				"Authorization received. Return to the terminal. No token is displayed here.",
			);
		receiveCode(code);
	});
	const provider: OAuthClientProvider = {
		redirectUrl: callback,
		clientMetadata: {
			client_name: "Think-Wide OAuth acceptance",
			redirect_uris: [callback],
			grant_types: ["authorization_code"],
			response_types: ["code"],
			token_endpoint_auth_method: "none",
			scope: "openid profile email",
		},
		state: () => state,
		clientInformation: () => clientInfo,
		saveClientInformation: (value) => {
			clientInfo = value;
		},
		tokens: () => tokens,
		saveTokens: (value) => {
			tokens = value;
		},
		saveCodeVerifier: (value) => {
			verifier = value;
		},
		codeVerifier: () => {
			if (!verifier) throw new Error("No verifier");
			return verifier;
		},
		discoveryState: () => discovery,
		saveDiscoveryState: (value) => {
			discovery = value;
		},
		redirectToAuthorization: (url) => {
			if (
				url.origin !== issuer ||
				url.searchParams.get("state") !== state ||
				url.searchParams.get("code_challenge_method") !== "S256" ||
				url.searchParams.get("resource") !== resource.href
			)
				throw new Error("Unexpected authorization request");
			console.log(
				"Open this authorization URL in the browser on this machine:",
			);
			console.log(url.href); // State + PKCE challenge, never a token/code/verifier.
		},
	};
	let timer: ReturnType<typeof setTimeout> | undefined;
	let client: Client | undefined;
	try {
		await new Promise<void>((resolve, reject) => {
			listener.once("error", reject);
			listener.listen(3183, "127.0.0.1", resolve);
		});
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(
				() => reject(new Error("OAuth callback timeout")),
				5 * 60_000,
			);
		});
		const flow = async () => {
			if (
				(await auth(provider, {
					serverUrl: resource,
					scope: "openid profile email",
					fetchFn: boundedFetch,
				})) !== "REDIRECT"
			)
				throw new Error("Expected fresh interactive consent");
			const authorizationCode = await codePromise;
			if (
				(await auth(provider, {
					serverUrl: resource,
					authorizationCode,
					fetchFn: boundedFetch,
				})) !== "AUTHORIZED" ||
				!tokens
			)
				throw new Error("OAuth exchange failed");
			const { payload, protectedHeader } = await jwtVerify(
				tokens.access_token,
				createRemoteJWKSet(new URL("/oauth2/jwks", issuer)),
				{
					issuer,
					audience: resource.href,
					algorithms: ["RS256"],
					requiredClaims: ["iss", "sub", "aud", "iat", "exp"],
				},
			);
			if (!payload.sub) throw new Error("Missing subject");
			console.log(
				JSON.stringify({
					status: "verified real OAuth access token",
					algorithm: protectedHeader.alg,
					issuer: payload.iss,
					audience: payload.aud,
					lifetimeSeconds: Number(payload.exp) - Number(payload.iat),
					subjectSha256: fingerprint(payload.sub),
					mcpEndpoint: "NOT RUN",
				}),
			);
			if (process.env.WORKOS_SESSION_TEST_TOKEN) {
				const session = workosIssuer();
				const verified = await jwtVerify(
					process.env.WORKOS_SESSION_TEST_TOKEN,
					createRemoteJWKSet(
						new URL(`https://api.workos.com/sso/jwks/${session.clientId}`),
					),
					{
						issuer: session.issuer,
						algorithms: ["RS256"],
						requiredClaims: ["iss", "sub", "iat", "exp"],
					},
				);
				console.log(
					JSON.stringify({
						browserSubjectMatches: verified.payload.sub === payload.sub,
						convexTokenIdentifierMatches:
							`${verified.payload.iss}|${verified.payload.sub}` ===
							`${payload.iss}|${payload.sub}`,
					}),
				);
			}
			if (process.argv.includes("--call-mcp")) {
				client = new Client({ name: "think-wide-oauth-probe", version: "1" });
				await client.connect(
					new StreamableHTTPClientTransport(resource, {
						fetch: boundedFetch,
						requestInit: {
							headers: { Authorization: `Bearer ${tokens.access_token}` },
						},
					}),
				);
				const names = (await client.listTools()).tools.map((tool) => tool.name);
				if (JSON.stringify(names) !== JSON.stringify(MCP_TOOL_NAMES))
					throw new Error("Tool inventory mismatch");
				const result = await client.callTool({
					name: "getCapabilities",
					arguments: {},
				});
				if (result.isError) throw new Error("Capabilities call failed");
				console.log(
					JSON.stringify({
						mcpEndpoint: "tools/list and getCapabilities passed",
						toolCount: names.length,
					}),
				);
			}
		};
		await Promise.race([flow(), timeout]);
	} finally {
		controller.abort();
		if (timer) clearTimeout(timer);
		await client?.close();
		listener.closeAllConnections();
		await new Promise<void>((resolve) => listener.close(() => resolve()));
		tokens = undefined;
		verifier = undefined;
		clientInfo = undefined;
	}
}

await main().catch(() => {
	// OAuth/library failures can contain codes or raw provider responses.
	console.error(
		"OAuth probe failed or prerequisites are missing. No credentials were printed. Check the T08 HTTP runbook; do not weaken verification.",
	);
	process.exitCode = 1;
});
