import { expect, test } from "vitest";
import { CONTRACT_VERSION } from "../../generated/operations";
import { Finding, Proposal } from "../../generated/validators.js";

const claim = {
	statement: "Tentative finding",
	evidenceClass: "model_hypothesis",
	refs: [
		{
			repositoryId: "repo",
			snapshotId: "snapshot",
			entryId: "entry",
			commit: "a".repeat(40),
			hashAlgorithm: "sha1",
			blobId: "b".repeat(40),
			byteRange: { start: 0, end: 1 },
			digest: "c".repeat(64),
		},
	],
};
const finding = {
	findingId: "finding",
	summary: claim.statement,
	evidenceClass: claim.evidenceClass,
	refs: claim.refs,
	verification: "unverified",
	observedAt: 0,
};
const proposal = {
	investigationId: "investigation",
	baseRevision: 0,
	claims: [claim],
};

test("0.6.0 preserves the same bounded unknowns in proposals and findings", () => {
	expect(CONTRACT_VERSION).toBe("0.6.0");
	expect(Finding(finding)).toBe(true);
	for (const unknowns of [[], ["Question?"], Array(8).fill("x".repeat(512))]) {
		expect(Finding({ ...finding, unknowns })).toBe(true);
		expect(Proposal({ ...proposal, claims: [{ ...claim, unknowns }] })).toBe(
			true,
		);
	}
	for (const unknowns of [
		null,
		"not an array",
		[""],
		["x".repeat(513)],
		Array(9).fill("question"),
		[{ actor: "admin" }],
	]) {
		expect(Finding({ ...finding, unknowns })).toBe(false);
		expect(Proposal({ ...proposal, claims: [{ ...claim, unknowns }] })).toBe(
			false,
		);
	}
});
