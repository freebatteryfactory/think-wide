import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, parseEnv, promisify } from "node:util";
import {
	type FunctionArgs,
	type FunctionReference,
	getFunctionName,
} from "convex/server";
import { convexToJson } from "convex/values";
import { internal } from "../convex/_generated/api";
import type { Project } from "../generated/types";
import { readHistory } from "../src/server/git/history";
import { openSnapshot } from "../src/server/git/snapshot";
import { catalogSelection } from "./lib/catalog-fetch";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));

async function main() {
	const { values, positionals } = parseArgs({
		options: {
			"env-file": { type: "string", default: ".env.local" },
			owner: { type: "string" },
		},
		allowPositionals: true,
	});
	if (!values.owner || !positionals.length || positionals.length > 8)
		throw new Error(
			"Usage: catalog:seed --owner 'https://issuer|subject' [--env-file .env.local] PUBLIC_HTTPS_URL[@FULL_COMMIT] ... (1–8 URLs)",
		);
	const selections = positionals.map(catalogSelection);
	const envFile = resolve(values["env-file"]);
	const config = parseEnv(await readFile(envFile, "utf8"));
	if (
		!config.CONVEX_SELF_HOSTED_ADMIN_KEY ||
		!config.CONVEX_SELF_HOSTED_URL ||
		config.CONVEX_DEPLOYMENT ||
		config.CONVEX_DEPLOY_KEY
	)
		throw new Error("Use an explicit self-hosted CLI environment file");
	const endpoint = new URL(config.CONVEX_SELF_HOSTED_URL);
	if (
		endpoint.username ||
		endpoint.password ||
		endpoint.search ||
		endpoint.hash ||
		endpoint.pathname !== "/" ||
		(endpoint.protocol !== "https:" &&
			!(
				endpoint.protocol === "http:" &&
				["127.0.0.1", "[::1]"].includes(endpoint.hostname)
			))
	)
		throw new Error("CLI backend must be HTTPS or literal HTTP loopback");
	// Only the CLI child receives its credential file. Git has a separate minimal environment.
	async function invoke<
		F extends FunctionReference<"mutation" | "query", "internal">,
	>(reference: F, args: FunctionArgs<F>) {
		const encoded = JSON.stringify(convexToJson(args));
		if (Buffer.byteLength(encoded) > 112 * 1024)
			throw new Error(
				"Catalog ingestion arguments exceed the 112 KiB CLI bound",
			);
		const result = await exec(
			process.execPath,
			[
				join(root, "node_modules/convex/bin/main.js"),
				"run",
				getFunctionName(reference),
				encoded,
				"--env-file",
				envFile,
			],
			{
				cwd: root,
				env: { PATH: process.env.PATH, HOME: process.env.HOME },
				timeout: 30000,
				maxBuffer: 1024 * 1024,
			},
		);
		return result.stdout.trim();
	}
	for (const [index, selection] of selections.entries()) {
		const directory = await mkdtemp(join(tmpdir(), "think-wide-catalog-"));
		try {
			// Linux prlimit is required; no unbounded fallback. Existing runGit adds
			// 5s process/output bounds, kill groups, no hooks and no inherited Git config.
			const fetched = await exec(
				"/usr/bin/prlimit",
				[
					"--fsize=33554432",
					"--cpu=10",
					"--nofile=128",
					"--",
					process.execPath,
					join(root, "scripts/lib/catalog-fetch.ts"),
					directory,
					positionals[index],
				],
				{ env: { PATH: "/usr/bin:/bin" }, maxBuffer: 8192 },
			);
			const pin: unknown = JSON.parse(fetched.stdout);
			if (
				!pin ||
				typeof pin !== "object" ||
				!("commit" in pin) ||
				typeof pin.commit !== "string" ||
				!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(pin.commit)
			)
				throw new Error("Invalid Git pin result");
			const repositoryId = `public-${createHash("sha256").update(selection.url).digest("hex")}`;
			const snapshot = await openSnapshot({
				repositoryId,
				bundlePath: join(directory, "source.bundle"),
			});
			try {
				if (snapshot.summary.commit !== pin.commit)
					throw new Error("Snapshot does not match pinned commit");
				const ownerTokenIdentifier = values.owner;
				const snapshotId = snapshot.summary.snapshotId;
				const prior = await invoke(
					internal.operatorProvisioning.getCatalogIndexedAt,
					{ ownerTokenIdentifier, input: { snapshotId } },
				);
				const indexedAt: unknown = prior
					? JSON.parse(prior)
					: snapshot.summary.indexedAt;
				if (
					typeof indexedAt !== "number" ||
					!Number.isSafeInteger(indexedAt) ||
					indexedAt < 0
				)
					throw new Error("Invalid snapshot timestamp");
				const project: Project = {
					repositoryId,
					displayName: new URL(selection.url).pathname.replace(/^\//, ""),
					provider: "local-git",
					syncStatus: "ready",
					dataLabel: "public",
					snapshots: [{ ...snapshot.summary, indexedAt }],
				};
				await invoke(internal.operatorProvisioning.registerSnapshot, {
					ownerTokenIdentifier,
					input: { project, entries: snapshot.entries },
				});
				let cached = 0;
				let uncached = 0;
				for (const entry of snapshot.entries) {
					if (entry.kind !== "blob") continue;
					if (entry.size === undefined || entry.size > 48 * 1024) {
						uncached++;
						continue;
					}
					await invoke(internal.operatorProvisioning.cacheSource, {
						ownerTokenIdentifier,
						input: {
							snapshotId,
							entryId: entry.entryId,
							bytes: Uint8Array.from(await snapshot.blob(entry.entryId)).buffer,
						},
					});
					cached++;
				}
				const history = await readHistory(snapshot, {
					snapshotId,
					maxCommits: 20,
				});
				await invoke(internal.operatorProvisioning.cacheHistory, {
					ownerTokenIdentifier,
					input: {
						snapshotId,
						records: history.entries,
						complete: !history.truncated.is,
					},
				});
				await invoke(internal.operatorProvisioning.setDemoCatalog, {
					ownerTokenIdentifier,
					input: { snapshotId, enabled: true },
				});
				console.log(
					JSON.stringify({
						repositoryUrl: selection.url,
						commit: pin.commit,
						snapshotId,
						cachedBlobs: cached,
						uncachedBlobs: uncached,
						historyComplete: !history.truncated.is,
						catalog: "published",
					}),
				);
			} finally {
				await snapshot.close();
			}
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}
}
main().catch(() => {
	console.error(
		"Catalog seed failed. Check public HTTPS selections, full commits, --owner, CLI environment and resource bounds. Earlier successfully published URLs remain; rerunning exact pins is safe. No provider output or credentials are printed.",
	);
	process.exitCode = 1;
});
