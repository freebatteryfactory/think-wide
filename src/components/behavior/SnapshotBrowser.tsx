import { useConvexConnectionState, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { SnapshotEntry, SourceRef } from "../../../generated/types";
import { SnapshotEntry as isEntry } from "../../../generated/validators.js";
import { SourceViewer } from "../shell/SourceViewer";
import { Button } from "../ui/button";
import { OperationPanel } from "./OperationPanel";

export function SnapshotBrowser({
	snapshotId,
	onUse,
}: {
	snapshotId: string;
	onUse?: (ref: SourceRef) => void;
}) {
	const connection = useConvexConnectionState();
	const [parents, setParents] = useState<SnapshotEntry[]>([]);
	const [cursor, setCursor] = useState<string>();
	const [file, setFile] = useState<SnapshotEntry>();
	const parent = parents.at(-1);
	const page = useQuery(api.snapshots.browseSnapshot, {
		request: {
			snapshotId,
			...(parent ? { parentEntryId: parent.entryId } : {}),
			...(cursor ? { cursor } : {}),
		},
	});
	if (!connection.isWebSocketConnected) {
		return <output>Connecting to snapshot service…</output>;
	}
	if (!page) {
		return <output>Loading snapshot…</output>;
	}
	const entries = page.entries.map((value) => {
		if (!isEntry(value)) {
			throw new Error("Invalid snapshot entry");
		}
		return value as SnapshotEntry;
	});
	return (
		<section className="space-y-3 rounded border p-4">
			<h3>Snapshot files: {parent?.displayPath ?? "/"}</h3>
			<p className="text-sm">
				Coverage: {page.coverage.status}. Entries are pinned to this immutable
				snapshot.
			</p>
			{parent || cursor ? (
				<Button
					variant="outline"
					onClick={() => {
						if (!cursor) {
							setParents(parents.slice(0, -1));
						}
						setCursor(undefined);
						setFile(undefined);
					}}
				>
					Back to {cursor ? "directory start" : "parent"}
				</Button>
			) : null}
			<ul className="space-y-2">
				{entries.map((entry) => (
					<li key={entry.entryId}>
						<Button
							variant="outline"
							disabled={entry.kind !== "tree" && entry.kind !== "blob"}
							onClick={() => {
								setFile(undefined);
								if (entry.kind === "tree") {
									setParents([...parents, entry]);
									setCursor(undefined);
								} else {
									setFile(entry);
								}
							}}
						>
							{entry.name} ({entry.kind})
						</Button>
					</li>
				))}
			</ul>
			{!entries.length ? <p>No entries on this page.</p> : null}
			{page.nextCursor ? (
				<Button
					variant="outline"
					onClick={() => {
						setCursor(page.nextCursor ?? undefined);
						setFile(undefined);
					}}
				>
					Next file page
				</Button>
			) : null}
			{file ? (
				<OperationPanel key={`${snapshotId}:${file.entryId}`}>
					<SourceViewer
						snapshotId={snapshotId}
						entryId={file.entryId}
						onUse={onUse}
					/>
				</OperationPanel>
			) : null}
		</section>
	);
}
