import { handoffBodyHash } from "../../../core/handoff";
import type { Evidence, SourceRef } from "../../../generated/types";
import { Evidence as isEvidence } from "../../../generated/validators.js";

export async function verifySourceEvidence(
	value: unknown,
	snapshotId: string,
	entryId: string,
	expected?: SourceRef,
): Promise<Evidence> {
	if (!isEvidence(value)) {
		throw new Error("Invalid source response");
	}
	const evidence = structuredClone(value) as Evidence;
	const ref = evidence.ref;
	if (
		ref.snapshotId !== snapshotId ||
		ref.entryId !== entryId ||
		new TextEncoder().encode(evidence.content).length !==
			ref.byteRange.end - ref.byteRange.start ||
		(await handoffBodyHash(evidence.content)) !== ref.digest
	) {
		throw new Error("Source identity or digest mismatch");
	}
	if (
		expected &&
		(ref.repositoryId !== expected.repositoryId ||
			ref.commit !== expected.commit ||
			ref.blobId !== expected.blobId ||
			ref.hashAlgorithm !== expected.hashAlgorithm ||
			ref.digest !== expected.digest ||
			ref.byteRange.start !== expected.byteRange.start ||
			ref.byteRange.end !== expected.byteRange.end ||
			evidence.rangeAdjusted)
	) {
		throw new Error("The exact referenced window is unavailable");
	}
	return evidence;
}
