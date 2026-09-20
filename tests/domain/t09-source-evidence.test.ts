import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import type { Evidence } from "../../generated/types";
import { verifySourceEvidence } from "../../src/components/behavior/source-evidence";

const content = '\ufeff<svg onload="alert(1)">\r\nCafé 東京\r\n';
const evidence: Evidence = {
	ref: {
		repositoryId: "repo",
		snapshotId: "snapshot",
		entryId: "entry",
		commit: "a".repeat(40),
		blobId: "b".repeat(40),
		hashAlgorithm: "sha1",
		byteRange: { start: 0, end: Buffer.byteLength(content) },
		digest: createHash("sha256").update(content).digest("hex"),
	},
	content,
	encoding: "utf8",
	blobSize: Buffer.byteLength(content),
	evidenceClass: "observed_literal",
	rangeAdjusted: false,
};
test("source verification preserves BOM/CRLF/Unicode and rejects swapped identity, range or bytes", async () => {
	expect(
		(await verifySourceEvidence(evidence, "snapshot", "entry", evidence.ref))
			.content,
	).toBe(content);
	for (const changed of [
		{ ...evidence, content: content.replace(/\r/g, "") },
		{ ...evidence, ref: { ...evidence.ref, entryId: "foreign" } },
		{ ...evidence, ref: { ...evidence.ref, digest: "0".repeat(64) } },
		{ ...evidence, ref: { ...evidence.ref, byteRange: { start: 0, end: 1 } } },
	]) {
		await expect(
			verifySourceEvidence(changed, "snapshot", "entry"),
		).rejects.toThrow();
	}
	await expect(
		verifySourceEvidence(evidence, "snapshot", "entry", {
			...evidence.ref,
			commit: "c".repeat(40),
		}),
	).rejects.toThrow();
});
