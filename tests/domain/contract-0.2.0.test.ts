// Contract 0.2.0 (issue #10, decision 0003): hash binding, invocable search modes, decision categories.
import { describe, expect, it } from "vitest";
import { CONTRACT_VERSION } from "../../generated/operations";
import * as v from "../../generated/validators.js";
import type { ScanEntry } from "../../src/server/search/caps.ts";
import { literalFinding } from "../../src/server/search/literal.ts";
import { structuralFinding } from "../../src/server/search/structural.ts";

const id40 = "a".repeat(40);
const id64 = "c".repeat(64);
const digest = "b".repeat(64);

const sourceRef = (hashAlgorithm: string, commit: string, blobId: string) => ({
	repositoryId: "repo_a",
	commit,
	hashAlgorithm,
	blobId,
	entryId: "entry_1",
	byteRange: { start: 0, end: 120 },
	digest,
});
const project = (
	hashAlgorithm: string,
	commit: string,
	rootTreeId: string,
) => ({
	repositoryId: "repo_a",
	displayName: "Repo A",
	provider: "local-git",
	syncStatus: "ready",
	snapshots: [
		{
			snapshotId: "snap_1",
			commit,
			hashAlgorithm,
			rootTreeId,
			indexedAt: 1700000000000,
			coverage: "complete",
		},
	],
});
const paths = (validator: v.Validator) =>
	(validator.errors ?? []).map((e) => e.instancePath).sort();

describe("contract 0.2.0: version", () => {
	it("is 0.6.0 after the MCP Apps view binding", () => {
		expect(CONTRACT_VERSION).toBe("0.6.0");
	});
});

describe("contract 0.2.0: object id length is bound to hashAlgorithm", () => {
	it("SourceRef accepts the correct pairings", () => {
		expect(v.SourceRef(sourceRef("sha1", id40, id40))).toBe(true);
		expect(v.SourceRef(sourceRef("sha256", id64, id64))).toBe(true);
	});

	it("SourceRef rejects sha1 with 64-char ids, naming both fields", () => {
		expect(v.SourceRef(sourceRef("sha1", id64, id64))).toBe(false);
		expect(paths(v.SourceRef)).toEqual(
			expect.arrayContaining(["/blobId", "/commit"]),
		);
	});

	it("SourceRef rejects sha256 with 40-char ids, naming both fields", () => {
		expect(v.SourceRef(sourceRef("sha256", id40, id40))).toBe(false);
		expect(paths(v.SourceRef)).toEqual(
			expect.arrayContaining(["/blobId", "/commit"]),
		);
	});

	it("SourceRef rejects a single mismatched id", () => {
		expect(v.SourceRef(sourceRef("sha1", id40, id64))).toBe(false);
		expect(paths(v.SourceRef)).toContain("/blobId");
		expect(v.SourceRef(sourceRef("sha1", id64, id40))).toBe(false);
		expect(paths(v.SourceRef)).toContain("/commit");
		expect(v.SourceRef(sourceRef("sha256", id64, id40))).toBe(false);
		expect(v.SourceRef(sourceRef("sha256", id40, id64))).toBe(false);
	});

	it("SourceRef still rejects an unknown algorithm and a missing one", () => {
		expect(v.SourceRef(sourceRef("md5", id40, id40))).toBe(false);
		const { hashAlgorithm: _omitted, ...missing } = sourceRef(
			"sha1",
			id40,
			id40,
		);
		expect(v.SourceRef(missing)).toBe(false);
	});

	it("binds a ref nested inside a request", () => {
		const decision = (ref: unknown) => ({
			investigationId: "inv_1",
			expectedRevision: 0,
			kind: "correction",
			statement: "contract only",
			refs: [ref],
			requestKey: "req-00000001",
		});
		expect(
			v.RecordDecisionRequest(decision(sourceRef("sha1", id40, id40))),
		).toBe(true);
		expect(
			v.RecordDecisionRequest(decision(sourceRef("sha256", id40, id40))),
		).toBe(false);
	});

	it("SnapshotSummary accepts the correct pairings", () => {
		expect(v.Project(project("sha1", id40, id40))).toBe(true);
		expect(v.Project(project("sha256", id64, id64))).toBe(true);
	});

	it("SnapshotSummary rejects sha1 with 64-char ids", () => {
		expect(v.Project(project("sha1", id64, id64))).toBe(false);
		expect(paths(v.Project)).toEqual(
			expect.arrayContaining([
				"/snapshots/0/commit",
				"/snapshots/0/rootTreeId",
			]),
		);
	});

	it("SnapshotSummary rejects sha256 with 40-char ids", () => {
		expect(v.Project(project("sha256", id40, id40))).toBe(false);
		expect(paths(v.Project)).toEqual(
			expect.arrayContaining([
				"/snapshots/0/commit",
				"/snapshots/0/rootTreeId",
			]),
		);
		expect(v.Project(project("sha256", id64, id40))).toBe(false);
		expect(v.Project(project("sha1", id40, id64))).toBe(false);
	});
});

describe("contract 0.2.0: capabilities advertise only invocable search modes", () => {
	const capabilities = (searchModes: unknown) => ({
		contractVersion: "0.2.0",
		mode: "local-demo",
		authProfile: "local-fixed-principal",
		searchModes,
		limits: {
			searchHitsPerPage: 20,
			treeChildrenPerPage: 100,
			resultTextBytes: 16384,
			exactWindowBytes: 16384,
		},
		integrations: {
			hostedIdentity: "not_run",
			remoteMcp: "not_run",
			githubApp: "disabled",
			issuePublish: "disabled",
			backendReasoning: "not_run",
			outcomeIngestion: "disabled",
		},
	});

	it("accepts literal and structural", () => {
		expect(v.Capabilities(capabilities(["literal", "structural"]))).toBe(true);
		expect(v.Capabilities(capabilities([]))).toBe(true);
	});

	it("rejects semantic and type, which have no SearchSourcesRequest branch", () => {
		expect(v.Capabilities(capabilities(["semantic"]))).toBe(false);
		expect(v.Capabilities.errors?.[0]?.instancePath).toBe("/searchModes/0");
		expect(v.Capabilities(capabilities(["type"]))).toBe(false);
		expect(v.Capabilities(capabilities(["literal", "semantic"]))).toBe(false);
	});

	it("every advertised mode is invocable", () => {
		for (const mode of ["literal", "structural"]) {
			const query = mode === "literal" ? { text: "x" } : { ruleId: "r1" };
			expect(v.SearchSourcesRequest({ snapshotIds: ["s1"], mode, query })).toBe(
				true,
			);
		}
	});
});

const KINDS = ["correction", "constraint", "rejection", "acceptance"] as const;
const CATEGORIES = ["architecture", "security"] as const;
const BAD_CATEGORIES: [string, unknown][] = [
	["unknown value", "performance"],
	["null", null],
	["array", ["security"]],
	["empty string", ""],
	["wrong case", "Security"],
	["upper case", "ARCHITECTURE"],
	["padded", " security"],
	["number", 1],
	["object", { value: "security" }],
];
const withCategory = <T extends object>(base: T, category?: unknown) =>
	category === undefined ? base : { ...base, category };

describe("contract 0.2.0: decision categories (decision 0003)", () => {
	const request = (kind: string, category?: unknown) =>
		withCategory(
			{
				investigationId: "inv_1",
				expectedRevision: 0,
				kind,
				statement: "never log authentication tokens",
				requestKey: "req-00000001",
			},
			category,
		);
	const decision = (kind: string, category?: unknown) =>
		withCategory(
			{
				decisionId: "dec_1",
				investigationId: "inv_1",
				kind,
				statement: "never log authentication tokens",
				madeAtRevision: 0,
				resultingRevision: 1,
				createdAt: 1700000000000,
			},
			category,
		);
	const handoff = (category?: unknown, present = true) => ({
		handoffId: "handoff_1",
		handoffRevision: 1,
		investigationId: "inv_1",
		investigationRevision: 1,
		objective: "Align the command contract between A and B",
		targetRepository: {
			repositoryId: "repo_a",
			baseCommit: id40,
			hashAlgorithm: "sha1",
		},
		constraints: [
			{
				statement: "never log authentication tokens",
				decisionId: "dec_1",
				kind: "constraint",
				...(present ? { category } : {}),
			},
		],
		evidence: [],
		acceptance: [{ behavior: "A and B agree", status: "not_run" }],
		audience: "private_download",
		bodyMarkdown: "# Handoff",
		bodyHash: digest,
		preparedAt: 1700000000000,
		publication: { status: "prepared" },
	});

	for (const kind of KINDS) {
		it(`${kind}: omission is accepted on request and response`, () => {
			expect(v.RecordDecisionRequest(request(kind))).toBe(true);
			expect(v.Decision(decision(kind))).toBe(true);
		});
		for (const category of CATEGORIES)
			it(`${kind} x ${category} is accepted on request and response`, () => {
				expect(v.RecordDecisionRequest(request(kind, category))).toBe(true);
				expect(v.Decision(decision(kind, category))).toBe(true);
			});
	}

	for (const [label, bad] of BAD_CATEGORIES)
		it(`rejects category = ${label} on request, response and handoff constraint`, () => {
			for (const kind of KINDS) {
				expect(v.RecordDecisionRequest(request(kind, bad))).toBe(false);
				expect(paths(v.RecordDecisionRequest)).toContain("/category");
				expect(v.Decision(decision(kind, bad))).toBe(false);
				expect(paths(v.Decision)).toContain("/category");
			}
			expect(v.Handoff(handoff(bad))).toBe(false);
			expect(paths(v.Handoff)).toContain("/constraints/0/category");
		});

	it("a category is never a decision kind", () => {
		for (const category of CATEGORIES) {
			expect(v.RecordDecisionRequest(request(category))).toBe(false);
			expect(v.Decision(decision(category))).toBe(false);
		}
	});

	it("HandoffConstraint accepts both categories and omission", () => {
		for (const category of CATEGORIES)
			expect(v.Handoff(handoff(category))).toBe(true);
		expect(v.Handoff(handoff(undefined, false))).toBe(true);
	});

	it("category is not part of the composition catalog", () => {
		const pair = {
			component: "EvidencePair",
			left: sourceRef("sha1", id40, id40),
			right: sourceRef("sha1", id40, id40),
		};
		const composition = (extra: object) => ({
			catalogVersion: "1",
			root: { component: "Stack", children: [pair], ...extra },
		});
		expect(v.Composition(composition({}))).toBe(true);
		expect(v.Composition(composition({ category: "security" }))).toBe(false);
	});
});

describe("contract 0.2.0: search findings name the Git object hash algorithm of their ids", () => {
	// Pure constructors, no analyzer binary: this runs even where the ast-grep tests skip.
	const entry = (commit: string, blobId: string): ScanEntry => ({
		repositoryId: "repo.alpha",
		snapshotId: "snap.alpha.1",
		commit,
		entryId: "entry.alpha.src_alpha.ts",
		blobId,
		path: "src/alpha.ts",
		kind: "blob",
		bytes: Buffer.from("export const alphaMarker = 1\n", "utf8"),
	});
	const rule = {
		ruleId: "r1",
		language: "typescript",
		yaml: "id: r1",
		ruleHash: digest,
	};
	const probe = {
		available: true,
		version: "0.0.0",
		isolation: { mode: "none", reason: "constructor test, nothing is run" },
	} as const;
	const findings = (e: ScanEntry) => [
		literalFinding(e, 13, 24, 1700000000000),
		structuralFinding(e, 13, 24, rule, probe, 1700000000000),
	];

	it("40-hex ids produce sha1 refs the contract accepts", () => {
		for (const finding of findings(entry(id40, id40))) {
			expect(finding.refs[0]?.hashAlgorithm).toBe("sha1");
			expect(v.Finding(finding)).toBe(true);
		}
	});

	it("64-hex ids produce sha256 refs the contract accepts", () => {
		for (const finding of findings(entry(id64, id64))) {
			expect(finding.refs[0]?.hashAlgorithm).toBe("sha256");
			expect(v.Finding(finding)).toBe(true);
		}
	});

	it("an entry whose commit and blob ids disagree yields a ref the contract rejects", () => {
		for (const finding of findings(entry(id40, id64)))
			expect(v.Finding(finding)).toBe(false);
	});
});
