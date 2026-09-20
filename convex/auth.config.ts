/// <reference types="node" />
import type { AuthConfig } from "convex/server";

const local = process.env.THINK_WIDE_MODE === "local-demo";
// Convex evaluates bundles with NODE_ENV=production even on the local backend.
// Local trust is an explicit deployment setting; the Node issuer independently
// refuses production and can send tokens only to a literal loopback backend.
if (local && !process.env.THINK_WIDE_LOCAL_JWKS?.startsWith("data:text/plain;charset=utf-8;base64,")) {
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
const workos = workosClientId ? [{
  type: "customJwt" as const,
  issuer: `https://api.workos.com/user_management/${workosClientId}`,
  jwks: `https://api.workos.com/sso/jwks/${workosClientId}`,
  algorithm: "RS256" as const,
 }] : [];
export default {
 providers: local ? [{
  type: "customJwt",
  applicationID: "think-wide-local",
  issuer: "http://127.0.0.1/think-wide-local",
  jwks: process.env.THINK_WIDE_LOCAL_JWKS!,
  algorithm: "RS256",
 }] : workos,
} satisfies AuthConfig;
