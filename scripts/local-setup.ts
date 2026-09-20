import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv, promisify } from "node:util";
import { getFunctionName } from "convex/server";
import { convexToJson } from "convex/values";
import { createLocalJWKSet, jwtVerify } from "jose";
import type { Project } from "../generated/types";
import { Project as validProject } from "../generated/validators.js";
import {
	LOCAL_AUDIENCE,
	LOCAL_ISSUER,
	localIssuer,
} from "../src/server/auth/local-issuer";
import { serverConfig } from "../src/server/config";
import { dispatch } from "../src/server/ops/dispatch";
import { seedLocalFixtures } from "./lib/local-fixtures";

const root = fileURLToPath(new URL("../", import.meta.url));
const exec = promisify(execFile);

async function main() {
	if (process.argv.length !== 2)
		throw new Error("local:setup accepts no arguments");
	const config = serverConfig();
	if (config.mode !== "local-demo" || process.env.NODE_ENV === "production") {
		throw new Error("local:setup requires non-production local-demo mode");
	}
	if (!process.env.CONVEX_SELF_HOSTED_ADMIN_KEY) {
		throw new Error(
			"Set the local backend admin credential in .env.local first",
		);
	}
	// --env-file selects the deployment independently of process.env in Convex 1.46.
	// Validate the exact same file before allowing a CLI mutation.
	const file = parseEnv(await readFile(resolve(root, ".env.local"), "utf8"));
	if (
		file.CONVEX_DEPLOY_KEY ||
		file.CONVEX_DEPLOYMENT ||
		serverConfig({ ...file, NODE_ENV: process.env.NODE_ENV }).convexUrl !==
			config.convexUrl ||
		file.THINK_WIDE_MODE !== "local-demo" ||
		file.CONVEX_SELF_HOSTED_ADMIN_KEY !==
			process.env.CONVEX_SELF_HOSTED_ADMIN_KEY
	) {
		throw new Error(
			"local:setup refuses conflicting deployment selectors in .env.local",
		);
	}
	const issuer = await localIssuer();
	const cli = async (step: string, args: string[]) => {
		try {
			await exec(
				process.execPath,
				[
					resolve(root, "node_modules/convex/bin/main.js"),
					...args,
					"--env-file",
					resolve(root, ".env.local"),
				],
				{
					cwd: root,
					env: { ...process.env, CONVEX_SELF_HOSTED_URL: config.convexUrl },
					timeout: 120000,
					maxBuffer: 1024 * 1024,
				},
			);
		} catch {
			// CLI failures may include credentials, arguments or backend stack traces.
			throw new Error(
				`local:setup failed during ${step}; check the local backend and .env.local`,
			);
		}
	};
	await cli("public key configuration", [
		"env",
		"set",
		"THINK_WIDE_LOCAL_JWKS",
		issuer.jwksDataUri,
	]);
	await cli("local mode configuration", [
		"env",
		"set",
		"THINK_WIDE_MODE",
		"local-demo",
	]);
	await cli("Convex push", ["dev", "--once"]);
	// Verify the token and actual public handler before trusted operator ingestion.
	const token = await issuer.mint();
	const jwks = JSON.parse(
		Buffer.from(issuer.jwksDataUri.split(",")[1], "base64").toString("utf8"),
	);
	const { payload } = await jwtVerify(token, createLocalJWKSet(jwks), {
		issuer: LOCAL_ISSUER,
		audience: LOCAL_AUDIENCE,
		algorithms: ["RS256"],
	});
	if (!payload.sub) throw new Error("Local token has no subject");
	const capabilities = await dispatch("getCapabilities", {}, token);
	if ("code" in capabilities)
		throw new Error("Local JWT was not accepted by the backend");
	// Recipient comes from the signature-verified local token, never a CLI argument.
	const ownerTokenIdentifier = `${payload.iss}|${payload.sub}`;
	const existing: Project[] = [];
	let cursor: string | undefined;
	do {
		const page = await dispatch(
			"listProjects",
			cursor ? { cursor } : {},
			await issuer.mint(),
		);
		if (!("entries" in page) || !("nextCursor" in page))
			throw new Error("local:setup could not read existing snapshots");
		for (const project of page.entries) {
			if (!validProject(project))
				throw new Error("local:setup received invalid project metadata");
			existing.push(project as Project);
		}
		cursor = page.nextCursor ?? undefined;
	} while (cursor);
	const seeded = await seedLocalFixtures(
		async (reference, args) => {
			await cli("fixture ingestion", [
				"run",
				getFunctionName(reference),
				JSON.stringify(convexToJson(args)),
			]);
		},
		ownerTokenIdentifier,
		existing,
	);
	for (const item of seeded) {
		console.log(
			`${item.name}: snapshot ${item.snapshotId}; ${item.cached} blobs cached, ${item.uncached} outside the setup cache bound`,
		);
	}
	console.log(
		"Local identity and two synthetic snapshots are ready. Run bun run mcp:stdio from this checkout.",
	);
}
main().catch((error: unknown) => {
	// Only controlled setup errors are printed; raw provider errors are suppressed.
	console.error(
		error instanceof Error &&
			/^(local:setup|Set the local|Local JWT|Local token)/.test(error.message)
			? error.message
			: "local:setup refused configuration; check local-demo mode, literal loopback origin and private local key permissions",
	);
	process.exitCode = 1;
});
