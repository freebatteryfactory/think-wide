import { expect, test } from "vitest";
import { CONTRACT_VERSION } from "../../generated/operations";
import {
	HandoffRead,
	HandoffSummary,
	ReadHandoffRequest,
} from "../../generated/validators.js";

const summary = {
	handoffId: "brief",
	handoffRevision: 1,
	investigationId: "investigation",
	investigationRevision: 2,
	targetRepository: {
		repositoryId: "repo",
		baseCommit: "a".repeat(40),
		hashAlgorithm: "sha1",
	},
	audience: "private_download",
	bodyHash: "b".repeat(64),
	bodyByteLength: 5,
	preparedAt: 100,
};
test("contract 0.3.0 returns a bounded summary and rejects extra identity fields", () => {
	expect(CONTRACT_VERSION).toBe("0.6.0");
	expect(HandoffSummary(summary)).toBe(true);
	expect(HandoffRead(summary)).toBe(true);
	expect(HandoffRead({ ...summary, actor: "someone" })).toBe(false);
	expect(HandoffSummary({ ...summary, bodyByteLength: 262145 })).toBe(false);
});
test("body reads require the exact revision and range; identity stays outside requests", () => {
	const request = {
		handoffId: "brief",
		handoffRevision: 1,
		detail: "body",
		byteRange: { start: 0, end: 5 },
	};
	expect(ReadHandoffRequest(request)).toBe(true);
	for (const key of ["handoffRevision", "byteRange", "detail"]) {
		const incomplete = { ...request } as Record<string, unknown>;
		delete incomplete[key];
		expect(ReadHandoffRequest(incomplete)).toBe(false);
	}
	expect(ReadHandoffRequest({ ...request, actor: "someone" })).toBe(false);
	expect(
		ReadHandoffRequest({
			...request,
			byteRange: { start: 0, end: 5, principal: "someone" },
		}),
	).toBe(false);
	expect(ReadHandoffRequest({ handoffId: "brief", detail: "summary" })).toBe(
		true,
	);
});
test("body windows have a closed bounded shape and are distinct from full briefs", () => {
	const page = {
		handoffId: "brief",
		handoffRevision: 1,
		bodyHash: summary.bodyHash,
		bodyByteLength: 5,
		byteRange: { start: 0, end: 5 },
		content: "hello",
		nextRange: null,
	};
	expect(HandoffRead(page)).toBe(true);
	expect(HandoffRead({ ...page, content: "x".repeat(2049) })).toBe(false);
	expect(
		HandoffRead({ ...page, bodyMarkdown: "different representation" }),
	).toBe(false);
});

test("the brief's base commit is bound to a Git hash algorithm", () => {
	expect(HandoffSummary(summary)).toBe(true);
	const { hashAlgorithm: _omitted, ...noAlgorithm } = summary.targetRepository;
	expect(HandoffSummary({ ...summary, targetRepository: noAlgorithm })).toBe(
		false,
	);
	expect(
		HandoffSummary({
			...summary,
			targetRepository: {
				...summary.targetRepository,
				baseCommit: "a".repeat(64),
			},
		}),
	).toBe(false);
	expect(
		HandoffSummary({
			...summary,
			targetRepository: {
				...summary.targetRepository,
				hashAlgorithm: "sha256",
				baseCommit: "a".repeat(64),
			},
		}),
	).toBe(true);
});
