import { useConvexConnectionState, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Evidence, SourceRef } from "../../../generated/types";
import { verifySourceEvidence } from "../behavior/source-evidence";
import { Button } from "../ui/button";

export function SourceViewer({
	snapshotId,
	entryId,
	reference,
	onUse,
}: {
	snapshotId: string;
	entryId: string;
	reference?: SourceRef;
	onUse?: (ref: SourceRef) => void;
}) {
	const connection = useConvexConnectionState();
	const [range, setRange] = useState<Evidence["nextRange"]>();
	const response = useQuery(api.sourceCache.readSource, {
		request: {
			snapshotId,
			entryId,
			...(reference
				? { byteRange: reference.byteRange, maxBytes: 16384 }
				: { ...(range ? { byteRange: range } : {}), maxBytes: 2048 }),
		},
	});
	const [verified, setVerified] = useState<{
		response: Evidence;
		value: Evidence;
	}>();
	const [error, setError] = useState("");
	useEffect(() => {
		let current = true;
		setError("");
		if (response) {
			void verifySourceEvidence(response, snapshotId, entryId, reference).then(
				(value) => {
					if (current) {
						setVerified({ response, value });
					}
				},
				() => {
					if (current) {
						setError(
							"Exact source verification failed. No quotation is displayed.",
						);
					}
				},
			);
		}
		return () => {
			current = false;
		};
	}, [response, snapshotId, entryId, reference]);
	if (!connection.isWebSocketConnected) {
		return <output>Connecting to the source service…</output>;
	}
	if (error) {
		return <output>{error}</output>;
	}
	if (!response || verified?.response !== response) {
		return <output>Verifying exact source bytes…</output>;
	}
	const evidence = verified.value;
	return (
		<section className="space-y-3 rounded border p-4">
			<p className="break-all text-sm">
				{evidence.ref.displayPath ?? entryId} · bytes [
				{evidence.ref.byteRange.start}, {evidence.ref.byteRange.end}) of{" "}
				{evidence.blobSize}
			</p>
			<pre className="overflow-auto whitespace-pre-wrap break-all">
				{evidence.content}
			</pre>
			<p className="break-all font-mono text-xs">
				SHA-256: {evidence.ref.digest}
			</p>
			<p className="break-all text-xs">
				Commit: {evidence.ref.commit} · blob: {evidence.ref.blobId}
			</p>
			<div className="flex flex-wrap gap-3">
				{onUse ? (
					<Button type="button" onClick={() => onUse(evidence.ref)}>
						Attach this window to decision
					</Button>
				) : null}
				{!reference && evidence.nextRange ? (
					<Button
						type="button"
						variant="outline"
						onClick={() => setRange(evidence.nextRange)}
					>
						Read next exact window
					</Button>
				) : null}
				{range ? (
					<Button
						type="button"
						variant="outline"
						onClick={() => setRange(undefined)}
					>
						Back to start
					</Button>
				) : null}
			</div>
		</section>
	);
}
