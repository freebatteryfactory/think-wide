import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
	freezeHandoff,
	type HandoffInput,
	projectHandoffDecisions,
} from "../../core/handoff";
import type { Decision, SourceRef } from "../../generated/types";
import { Handoff as isHandoff } from "../../generated/validators.js";

const ref: SourceRef = {
	repositoryId: "repo_alpha",
	snapshotId: "snapshot_alpha",
	hashAlgorithm: "sha1",
	commit: "a".repeat(40),
	blobId: "b".repeat(40),
	entryId: "entry_alpha",
	displayPath: "src/café.ts",
	byteRange: { start: 9, end: 42 },
	digest: "c".repeat(64),
};

function decision(
	kind: Decision["kind"],
	revision: number,
	statement: string,
): Decision {
	return {
		decisionId: `decision_${revision}`,
		investigationId: "investigation_alpha",
		kind,
		statement,
		madeAtRevision: revision - 1,
		resultingRevision: revision,
		createdAt: 100 + revision,
	};
}

const decisions: Decision[] = [
	{
		...decision("correction", 1, "Keep CRLF and Unicode: café\r\n東京."),
		refs: [ref],
	},
	decision("rejection", 2, "Do not run target repository code."),
	decision("constraint", 3, "No authentication tokens in logs."),
	decision("acceptance", 4, "Proceed with the bounded read-only approach."),
];

function input(ledger = decisions): HandoffInput {
	return {
		handoffId: "handoff_alpha",
		handoffRevision: 1,
		investigationId: "investigation_alpha",
		investigationRevision: ledger.length,
		objective: "Preserve exact cross-repository evidence.",
		targetRepository: {
			repositoryId: "repo_alpha",
			baseCommit: "a".repeat(40),
			hashAlgorithm: "sha1",
		},
		constraints: projectHandoffDecisions(
			{ investigationId: "investigation_alpha", revision: ledger.length },
			ledger,
		),
		evidence: [
			{ ref, note: "Authorized reference; source availability awaits T05." },
		],
		acceptance: [
			{
				behavior: "Reload retains corrections and prior rejections.",
				status: "not_run",
			},
		],
		allowedScope: "Evidence reading and brief export.",
		excludedChanges: "Execution or modification of target repositories.",
		uncertainties: ["Snapshot existence must be verified by T05."],
		audience: "private_download",
		publication: { status: "prepared" },
		preparedAt: 200,
	};
}

describe("T09 deterministic private implementation brief", () => {
	test("retains decisions, exact refs, scope, base commit and independently verifiable body hash", async () => {
		const first = await freezeHandoff(input(), decisions);
		const second = await freezeHandoff(input(), [...decisions].reverse());
		expect(first).toEqual(second);
		expect(isHandoff(first)).toBe(true);
		expect(first.bodyHash).toBe(
			createHash("sha256").update(first.bodyMarkdown, "utf8").digest("hex"),
		);
		// Acceptance decisions reach the structured brief too (PR #20 review, R1).
		expect(first.constraints.map((item) => item.kind)).toEqual([
			"correction",
			"rejected_approach",
			"constraint",
			"acceptance",
		]);
		for (const entry of decisions)
			expect(first.bodyMarkdown).toContain(JSON.stringify(entry.statement));
		expect(first.evidence[0].ref).toEqual(ref);
		expect(first.bodyMarkdown).toContain("a".repeat(40));
		expect(first.bodyMarkdown).toContain("## Allowed scope");
		expect(first.bodyMarkdown).toContain("## Uncertainties");
		expect(first.acceptance[0].status).toBe("not_run");
		expect(first.bodyMarkdown).not.toContain(first.bodyHash);
	});

	test("does not mutate inputs or retain mutable references across the digest", async () => {
		const fields = input();
		const before = structuredClone(fields);
		const promise = freezeHandoff(fields, decisions);
		fields.evidence[0].note = "changed while hashing";
		const result = await promise;
		expect(result.evidence).toEqual(before.evidence);
		expect(result.bodyMarkdown).not.toContain("changed while hashing");
		expect(fields).not.toHaveProperty("bodyHash");
	});

	test("equivalent object key orders yield identical Markdown and hashes", async () => {
		const normal = input();
		const reversedRef = Object.fromEntries(
			Object.entries(ref).reverse(),
		) as SourceRef;
		const reordered = {
			...normal,
			targetRepository: {
				hashAlgorithm: normal.targetRepository.hashAlgorithm,
				baseCommit: normal.targetRepository.baseCommit,
				repositoryId: normal.targetRepository.repositoryId,
			},
			evidence: [{ note: normal.evidence[0].note, ref: reversedRef }],
		};
		const reorderedDecisions = decisions.map(({ statement, ...rest }) => ({
			statement,
			...rest,
		}));
		const first = await freezeHandoff(normal, decisions);
		const second = await freezeHandoff(reordered, reorderedDecisions);
		expect(second.bodyMarkdown).toBe(first.bodyMarkdown);
		expect(second.bodyHash).toBe(first.bodyHash);
	});

	test("rejects lossy Unicode conversion instead of hashing replacement bytes", async () => {
		await expect(
			freezeHandoff(
				{ ...input(), objective: "invalid \ud800 text" },
				decisions,
			),
		).rejects.toMatchObject({ code: "invalid_request" });
	});

	test("keeps embedded fences and HTML as literal input", async () => {
		const objective =
			"Before\n```\n# Injected section\n<script>alert(1)</script>\n````\nAfter";
		const result = await freezeHandoff({ ...input(), objective }, decisions);
		expect(result.bodyMarkdown).toContain(
			`\`\`\`\`\`text\n${objective}\n\`\`\`\`\``,
		);
		expect(result.objective).toBe(objective);
	});

	test("rejects partial, duplicated, foreign and mixed revision decision ledgers", () => {
		for (const ledger of [
			decisions.slice(1),
			[decisions[0], ...decisions.slice(0, 3)],
			decisions.map((item, index) =>
				index === 2 ? { ...item, investigationId: "foreign" } : item,
			),
			decisions.map((item, index) =>
				index === 2 ? { ...item, madeAtRevision: 0 } : item,
			),
		]) {
			expect(() =>
				projectHandoffDecisions(
					{ investigationId: "investigation_alpha", revision: 4 },
					ledger,
				),
			).toThrow("complete decision ledger");
		}
	});

	test("cannot drop or rewrite a rejection while rendering a brief", async () => {
		const fields = input();
		fields.constraints = fields.constraints.filter(
			(constraint) => constraint.kind !== "rejected_approach",
		);
		await expect(freezeHandoff(fields, decisions)).rejects.toMatchObject({
			code: "invalid_request",
		});
	});

	test("preserves categories in structured constraints and rejects omitted or changed categories", async () => {
		const categorized: Decision[] = decisions.map((item, index) => ({
			...item,
			...(index === 1 ? {} : { category: "security" as const }),
		}));
		const fields = input(categorized);
		const result = await freezeHandoff(fields, categorized);
		expect(result.constraints[0].category).toBe("security");
		expect(result.constraints[1]).not.toHaveProperty("category");
		expect(result.bodyMarkdown).toContain('"category": "security"');
		for (const category of [undefined, "architecture"] as const) {
			const changed = structuredClone(fields);
			if (category === undefined) delete changed.constraints[0].category;
			else changed.constraints[0].category = category;
			await expect(freezeHandoff(changed, categorized)).rejects.toMatchObject({
				code: "invalid_request",
			});
		}
		const invented = input();
		invented.constraints[0].category = "architecture";
		await expect(freezeHandoff(invented, decisions)).rejects.toMatchObject({
			code: "invalid_request",
		});
	});

	test("refuses extra decision fields rather than silently dropping future metadata", () => {
		const categorized = decisions.map((item) => ({
			...item,
			futureMetadata: "unsupported",
		}));
		expect(() =>
			projectHandoffDecisions(
				{ investigationId: "investigation_alpha", revision: 4 },
				categorized,
			),
		).toThrow();
	});

	test.each([
		"private_issue",
		"public_issue",
	] as const)("disables %s without an audience/publication integration", async (audience) => {
		await expect(
			freezeHandoff({ ...input(), audience }, decisions),
		).rejects.toMatchObject({ code: "capability_disabled" });
	});

	test("cannot claim published output or successful acceptance tests", async () => {
		await expect(
			freezeHandoff(
				{ ...input(), publication: { status: "published" } },
				decisions,
			),
		).rejects.toMatchObject({ code: "capability_disabled" });
		await expect(
			freezeHandoff(
				{
					...input(),
					acceptance: [{ behavior: "Unproven", status: "ci_reported" }],
				},
				decisions,
			),
		).rejects.toMatchObject({ code: "invalid_request" });
	});

	test.each([
		{ ...ref, snapshotId: undefined },
		{ ...ref, byteRange: { start: 42, end: 9 } },
	])("rejects a ref with missing exact identity or inconsistent range/hash", async (invalid) => {
		await expect(
			freezeHandoff(
				{ ...input(), evidence: [{ ref: invalid, note: "Invalid ref" }] },
				decisions,
			),
		).rejects.toMatchObject({ code: "source_unavailable" });
	});

	test("contract 0.2.0 rejects algorithm-mismatched object IDs before formatting", async () => {
		await expect(
			freezeHandoff(
				{
					...input(),
					evidence: [
						{ ref: { ...ref, hashAlgorithm: "sha256" }, note: "Invalid ref" },
					],
				},
				decisions,
			),
		).rejects.toMatchObject({ code: "invalid_request" });
	});

	test("retains larger UTF-8 briefs for ranged reads without clipping", async () => {
		const result = await freezeHandoff(
			{ ...input(), objective: "界".repeat(8000) },
			decisions,
		);
		expect(
			new TextEncoder().encode(result.bodyMarkdown).length,
		).toBeGreaterThan(16384);
		expect(result.objective).toBe("界".repeat(8000));
	});

	test("refuses more than 32 constraints without forgetting any decision", () => {
		const ledger = Array.from({ length: 33 }, (_, index) =>
			decision("constraint", index + 1, "Preserve me"),
		);
		expect(() => input(ledger)).toThrow("none were dropped");
	});
});
