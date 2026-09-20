import { fileURLToPath } from "node:url";
import type { FunctionArgs, FunctionReference } from "convex/server";
import { internal } from "../../convex/_generated/api";
import type { Project } from "../../generated/types";
import { readHistory } from "../../src/server/git/history";
import { openSnapshot } from "../../src/server/git/snapshot";

export type Ingest = <F extends FunctionReference<"mutation", "internal">>(
	reference: F,
	args: FunctionArgs<F>,
) => Promise<unknown>;

/** Operator-selected committed synthetic bundles only; no target code executes. */
export async function seedLocalFixtures(
	ingest: Ingest,
	existing: readonly Project[] = [],
) {
	const results = [];
	for (const name of ["alpha", "beta"] as const) {
		const snapshot = await openSnapshot({
			repositoryId: `local-demo-${name}`,
			bundlePath: fileURLToPath(
				new URL(`../../tests/fixtures/repos/${name}.bundle`, import.meta.url),
			),
		});
		try {
			const project: Project = {
				repositoryId: snapshot.repositoryId,
				displayName: `Synthetic ${name}`,
				provider: "local-git",
				syncStatus: "ready",
				dataLabel: "synthetic",
				snapshots: [
					{
						...snapshot.summary,
						indexedAt:
							existing
								.flatMap((item) => item.snapshots)
								.find((item) => item.snapshotId === snapshot.summary.snapshotId)
								?.indexedAt ?? snapshot.summary.indexedAt,
					},
				],
			};
			await ingest(internal.snapshots.register, {
				project,
				entries: snapshot.entries,
			});
			let cached = 0;
			let uncached = 0;
			for (const entry of snapshot.entries) {
				if (entry.kind !== "blob") continue;
				// Bound CLI arguments below Linux's per-argument limit after base64.
				// Larger entries remain visible but exact reads are source_unavailable.
				if (entry.size === undefined || entry.size > 48 * 1024) {
					uncached++;
					continue;
				}
				await ingest(internal.sourceCache.put, {
					snapshotId: snapshot.summary.snapshotId,
					entryId: entry.entryId,
					bytes: Uint8Array.from(await snapshot.blob(entry.entryId)).buffer,
				});
				cached++;
			}
			const history = await readHistory(snapshot, {
				snapshotId: snapshot.summary.snapshotId,
				maxCommits: 20,
			});
			await ingest(internal.snapshots.putHistory, {
				snapshotId: snapshot.summary.snapshotId,
				records: history.entries,
				complete: !history.truncated.is,
			});
			results.push({
				name,
				snapshotId: snapshot.summary.snapshotId,
				cached,
				uncached,
			});
		} finally {
			await snapshot.close();
		}
	}
	return results;
}
