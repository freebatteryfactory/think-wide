// Reuse the app's compiled configuration check; do not fork its identity policy.
import { serverConfig } from "./production-config.mjs";
try {
	if (
		process.env.NODE_ENV !== "production" ||
		process.env.THINK_WIDE_MODE !== "connected"
	) {
		throw new Error("Connected production mode required");
	}
	for (const name of [
		"CONVEX_SELF_HOSTED_ADMIN_KEY",
		"INSTANCE_SECRET",
		"THINK_WIDE_LOCAL_JWKS",
		"THINKWIDE_ALLOW_UNISOLATED_ANALYZER",
	]) {
		if (process.env[name] !== undefined) {
			throw new Error("Privileged or development environment is forbidden");
		}
	}
	if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
		throw new Error("TLS verification must remain enabled");
	}
	serverConfig();
} catch {
	console.error("Think-Wide production configuration rejected");
	process.exit(1);
}
await import("./.output/server/index.mjs");
