import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { HandoffExport } from "../../src/components/behavior/HandoffExport";

test("saved brief export has labeled controls and disabled issue publication", () => {
	const html = renderToStaticMarkup(
		<HandoffExport
			selection={{
				handoffId: "handoff",
				handoffRevision: 2,
				bodyHash: "c".repeat(64),
			}}
			read={async () => {
				throw new Error("Rendering must not call a reader");
			}}
		/>,
	);
	expect(html).toMatch(
		/<button[^>]*disabled[^>]*>Publish GitHub issue<\/button>/,
	);
	expect(html).toContain("Copy Markdown");
	expect(html).toContain("SHA-256:");
});
