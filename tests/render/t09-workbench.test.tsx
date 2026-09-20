import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { DecisionEditor } from "../../src/components/behavior/DecisionEditor";
import { InvestigationAccess } from "../../src/components/behavior/InvestigationAccess";
import {
	InvestigationEvidence,
	SourceReference,
} from "../../src/components/behavior/InvestigationEvidence";

describe("T09 presentation (server render, no authenticated browser claim)", () => {
	test("persistent editor preserves escaped exact drafts and distinguishes save from preview", () => {
		const draft = {
			kind: "rejection" as const,
			statement: "<script>unsafe()</script>\r\n  Keep this.  ",
		};
		const html = renderToStaticMarkup(
			<DecisionEditor
				draft={draft}
				onDraftChange={() => {}}
				onSave={() => {}}
				locked={false}
				saveDisabled={true}
				submitLabel="Save decision"
				message="Draft retained"
				review={{ revision: 7, onConfirm: () => {} }}
			/>,
		);
		expect(html).toContain("Your judgment belongs here");
		expect(html).toContain("Save decision");
		expect(html).not.toContain("Preview decision");
		expect(html).toContain("&lt;script&gt;");
		expect(html).not.toContain("<script>");
		expect(html).toContain("I reviewed revision 7");
		expect(html).toMatch(/type="submit"[^>]*disabled/);
		expect(html).toContain('maxLength="16384"');
	});

	test("an uncertain save locks the fields but leaves the same-save retry available", () => {
		const html = renderToStaticMarkup(
			<DecisionEditor
				draft={{ kind: "constraint", statement: "Keep me" }}
				onDraftChange={() => {}}
				onSave={() => {}}
				locked
				saveDisabled={false}
				submitLabel="Retry the same save"
				message="Outcome unknown"
			/>,
		);
		expect(html).toContain('<fieldset disabled=""');
		expect(html).toContain("Retry the same save");
		expect(html).not.toMatch(/type="submit"[^>]*disabled/);
	});

	test("source metadata stays inert and exact; empty evidence does not claim findings", () => {
		const html = renderToStaticMarkup(
			<SourceReference
				reference={{
					repositoryId: "repo",
					snapshotId: "snapshot",
					commit: "a".repeat(40),
					blobId: "b".repeat(40),
					hashAlgorithm: "sha1",
					entryId: "entry",
					byteRange: { start: 5, end: 20 },
					digest: "c".repeat(64),
					displayPath: '<img src="https://example.com/leak">',
				}}
			/>,
		);
		expect(html).toContain("[5, 20)");
		expect(html).toContain("c".repeat(64));
		expect(html).not.toContain("<img");
		expect(html).toContain("no quotation is reconstructed");
		expect(
			renderToStaticMarkup(<InvestigationEvidence findings={[]} />),
		).toContain("No findings have been recorded");
	});

	test("opening an investigation uses labeled controls", () => {
		const entry = renderToStaticMarkup(
			<InvestigationAccess onOpen={() => {}} />,
		);
		expect(entry).toContain("Investigation ID");
		expect(entry).toContain("Open investigation");
		expect(entry).toContain("aria-describedby=");
	});
});
