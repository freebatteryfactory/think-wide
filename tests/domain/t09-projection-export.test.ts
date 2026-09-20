import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { freezeHandoff, handoffBodyHash } from "../../core/handoff";
import { projectHandoffInputs } from "../../core/handoff-projection";
import type {
	Decision,
	Investigation,
	PrepareHandoffRequest,
	Project,
	SnapshotSummary,
	SourceRef,
} from "../../generated/types";
import { readHandoffExport } from "../../src/components/behavior/handoff-export";

const ref: SourceRef = {
	repositoryId: "repo_alpha",
	snapshotId: "snapshot_alpha",
	commit: "a".repeat(40),
	blobId: "b".repeat(40),
	entryId: "entry_alpha",
	hashAlgorithm: "sha1",
	byteRange: { start: 0, end: 9 },
	digest: "c".repeat(64),
};
const decision: Decision = {
	decisionId: "decision_alpha",
	investigationId: "investigation_alpha",
	kind: "rejection",
	statement: "Do not execute target code.\r\nPreserve café.",
	refs: [ref],
	madeAtRevision: 0,
	resultingRevision: 1,
	createdAt: 100,
};
const investigation: Investigation = {
	investigationId: decision.investigationId,
	question: "Compare the bounded source readers",
	revision: 1,
	status: "open",
	snapshotIds: ["snapshot_alpha"],
	createdAt: 50,
	acceptedFindings: [
		{
			findingId: "finding_alpha",
			evidenceClass: "model_hypothesis",
			summary: "These implementations may share a pattern",
			refs: [ref],
			verification: "unverified",
			observedAt: 60,
		},
	],
};
const request: PrepareHandoffRequest = {
	investigationId: investigation.investigationId,
	expectedRevision: 1,
	targetRepositoryId: "repo_alpha",
	audience: "private_download",
	requestKey: "t09-project-handoff",
};
const snapshot: SnapshotSummary = {
	snapshotId: "snapshot_alpha",
	commit: ref.commit,
	hashAlgorithm: "sha1",
	rootTreeId: "d".repeat(40),
	indexedAt: 40,
	coverage: "complete",
	resolvedFromRef: "main",
};
const target: Project = {
	repositoryId: "repo_alpha",
	displayName: "Synthetic alpha",
	provider: "local-git",
	syncStatus: "ready",
	dataLabel: "synthetic",
	snapshots: [snapshot],
};

async function savedBrief() {
	return freezeHandoff(
		{
			...projectHandoffInputs(request, investigation, [decision], target),
			handoffId: "handoff_alpha",
			handoffRevision: 1,
			preparedAt: 200,
			publication: { status: "prepared" },
			acceptance: [
				{ behavior: "A specialist verifies exact ranges", status: "not_run" },
			],
			allowedScope: "Source read behavior",
			excludedChanges: "Target code execution",
		},
		[decision],
	);
}

describe("T09 frozen-revision projection (synthetic source mapping)", () => {
	test("binds a full target commit and preserves both human and hypothesis provenance", async () => {
		const projection = projectHandoffInputs(
			request,
			investigation,
			[decision],
			target,
		);
		expect(projection.targetRepository.baseCommit).toBe(ref.commit);
		expect(projection.targetRepository.baseCommit).not.toBe("main");
		expect(projection.constraints[0].kind).toBe("rejected_approach");
		expect(projection.evidence).toHaveLength(2);
		expect(
			projection.evidence.some((item) =>
				item.note.includes("model_hypothesis / unverified"),
			),
		).toBe(true);
		expect((await savedBrief()).bodyMarkdown).toContain(
			"Do not execute target code.",
		);
	});

	test("refuses foreign target, snapshot, investigation and stale revision", () => {
		for (const invalid of [
			{ ...request, investigationId: "foreign" },
			{ ...request, targetRepositoryId: "foreign" },
			{ ...request, expectedRevision: 0 },
		]) {
			expect(() =>
				projectHandoffInputs(invalid, investigation, [decision], target),
			).toThrow();
		}
		expect(() =>
			projectHandoffInputs(request, investigation, [decision], {
				...target,
				snapshots: [{ ...snapshot, snapshotId: "foreign" }],
			}),
		).toThrow();
	});

	test("rejects ambiguous target snapshots instead of choosing a branch or latest commit", () => {
		expect(() =>
			projectHandoffInputs(
				request,
				{ ...investigation, snapshotIds: ["snapshot_alpha", "snapshot_beta"] },
				[decision],
				{
					...target,
					snapshots: [
						snapshot,
						{
							...snapshot,
							snapshotId: "snapshot_beta",
							commit: "e".repeat(40),
						},
					],
				},
			),
		).toThrow("unambiguous target");
	});

	test("rejects evidence outside the investigation and inconsistent target identity", () => {
		for (const invalidRef of [
			{ ...ref, snapshotId: "foreign" },
			{ ...ref, commit: "e".repeat(40) },
			{ ...ref, repositoryId: "foreign" },
		]) {
			expect(() =>
				projectHandoffInputs(
					request,
					investigation,
					[{ ...decision, refs: [invalidRef] }],
					target,
				),
			).toThrow();
		}
		expect(() =>
			projectHandoffInputs(
				request,
				investigation,
				[{ ...decision, targetFindingId: "foreign" }],
				target,
			),
		).toThrow();
	});

	test("does not invent evidence verification or omit overlong provenance", () => {
		const findings = investigation.acceptedFindings;
		if (!findings) {
			throw new Error("Missing test fixture");
		}
		expect(() =>
			projectHandoffInputs(
				request,
				{
					...investigation,
					acceptedFindings: [{ ...findings[0], summary: "x".repeat(512) }],
				},
				[decision],
				target,
			),
		).toThrow("nothing was truncated");
		expect(() =>
			projectHandoffInputs(
				request,
				{ ...investigation, status: "source_unavailable" },
				[decision],
				target,
			),
		).toThrow();
	});
});

describe("T09 exact export adapter (fixture reader, no authorization claim)", () => {
	test("every export re-reads the pinned brief and preserves the exact UTF-8 bytes", async () => {
		const saved = await savedBrief();
		const reads: unknown[] = [];
		const read = async (query: unknown) => {
			reads.push(query);
			return saved;
		};
		const first = await readHandoffExport(saved, read);
		const second = await readHandoffExport(saved, read);
		expect(reads).toEqual([
			{ handoffId: saved.handoffId, handoffRevision: 1, detail: "summary" },
			{ handoffId: saved.handoffId, handoffRevision: 1, detail: "summary" },
		]);
		expect(first).toEqual(second);
		expect(first.bodyMarkdown).toBe(saved.bodyMarkdown);
		expect(first.bodyHash).toBe(
			createHash("sha256").update(first.bodyMarkdown).digest("hex"),
		);
		expect(first.filename).toBe("think-wide-handoff_alpha-r1.md");
	});

	test("refuses altered text, changed revision and swapped IDs", async () => {
		const saved = await savedBrief();
		for (const changed of [
			{ ...saved, bodyMarkdown: `${saved.bodyMarkdown}\nInjected` },
			{ ...saved, handoffRevision: 2 },
			{ ...saved, handoffId: "foreign" },
		]) {
			await expect(
				readHandoffExport(saved, async () => changed),
			).rejects.toThrow();
		}
	});

	test("an unavailable reader cannot fall back to preview text", async () => {
		const saved = await savedBrief();
		await expect(
			readHandoffExport(saved, async () => {
				throw new Error("Network unavailable");
			}),
		).rejects.toThrow("Network unavailable");
	});

	test("refuses broader audience even with a matching hash", async () => {
		const saved = await savedBrief();
		await expect(
			readHandoffExport(saved, async () => ({
				...saved,
				audience: "public_issue",
			})),
		).rejects.toThrow("Only private download");
	});

	test("preserves BOM, CRLF and multibyte Unicode, but rejects lone surrogates", async () => {
		const text = "\ufeff# Brief\r\nCafé 東京\r\n";
		expect(await handoffBodyHash(text)).toBe(
			createHash("sha256").update(text).digest("hex"),
		);
		await expect(handoffBodyHash("bad \ud800")).rejects.toThrow(
			"exactly as UTF-8",
		);
	});
});

test("ranged export verifies every window and rejects discontinuity or tampering", async () => {
	const { handoffSummary, handoffBodyWindow } = await import(
		"../../core/handoff-read"
	);
	const saved = await savedBrief();
	const summary = handoffSummary(saved);
	const read = async (
		request: import("../../generated/types").ReadHandoffRequest,
	) =>
		request.detail === "summary" ? summary : handoffBodyWindow(saved, request);
	expect((await readHandoffExport(summary, read)).bodyMarkdown).toBe(
		saved.bodyMarkdown,
	);
	for (const mutation of ["content", "range", "cursor", "identity"] as const) {
		await expect(
			readHandoffExport(summary, async (request) => {
				if (request.detail === "summary") {
					return summary;
				}
				const page = handoffBodyWindow(saved, request);
				if (mutation === "content") {
					return { ...page, content: `X${page.content.slice(1)}` };
				}
				if (mutation === "range") {
					return { ...page, byteRange: { ...page.byteRange, start: 1 } };
				}
				if (mutation === "cursor") {
					return { ...page, nextRange: null };
				}
				return { ...page, handoffId: "foreign" };
			}),
		).rejects.toThrow();
	}
});
