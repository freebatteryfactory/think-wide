import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { DecisionEditor } from "../../src/components/behavior/DecisionEditor";
import {
	type DecisionDraft,
	decisionCategoryLabels,
	decisionCommand,
} from "../../src/components/behavior/workbench";

function render(draft: DecisionDraft) {
	return renderToStaticMarkup(
		<DecisionEditor
			draft={draft}
			onDraftChange={() => {}}
			onSave={() => {}}
			locked={false}
			saveDisabled={false}
			submitLabel="Save decision"
			message=""
		/>,
	);
}

describe("decision category presentation and wire shape", () => {
	test.each([
		undefined,
		"architecture",
		"security",
	] as const)("renders and emits exactly the selected category %s", (category) => {
		const draft: DecisionDraft = {
			kind: "constraint",
			statement: "Keep the human direction.",
			...(category ? { category } : {}),
		};
		const html = render(draft);
		expect(html).toContain(
			`<option value="${category ?? ""}" selected="">${category ? decisionCategoryLabels[category] : "Uncategorized"}</option>`,
		);
		const request = decisionCommand(
			{ investigationId: "investigation", revision: 0 },
			draft,
			"category-render-request",
		);
		if (category) expect(request.category).toBe(category);
		else expect(request).not.toHaveProperty("category");
	});

	test("places the optional category between action and statement before submit", () => {
		const html = render({ kind: "correction", statement: "Keep exact bytes" });
		expect(html).toContain("Category (optional)");
		const controls = [
			...html.matchAll(
				/<(select|textarea|button)\b[^>]*(?:id="([^"]+)"|type="submit")[^>]*>/g,
			),
		].map((match) => match[0]);
		expect(controls).toHaveLength(4);
		expect(controls[0]).toContain("-kind");
		expect(controls[1]).toContain("-category");
		expect(controls[2]).toContain("-statement");
		expect(controls[3]).toContain('type="submit"');
	});
});
