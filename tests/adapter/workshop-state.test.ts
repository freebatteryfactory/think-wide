import { describe, expect, it } from "vitest";
import { workshopData } from "../../src/components/workshop/fixtures";
import {
	initialWorkshopState,
	workshopReducer,
} from "../../src/components/workshop/state";

describe("human input survives workshop view changes", () => {
	it("preserves an acceptance draft and previews it without changing the finding", () => {
		const draft = {
			kind: "acceptance" as const,
			text: "Accept the shared receipt interface.",
		};
		let state = workshopReducer(initialWorkshopState, { type: "draft", draft });
		state = workshopReducer(state, { type: "view", view: "empty" });
		state = workshopReducer(state, { type: "view", view: "comparison" });
		state = workshopReducer(state, { type: "preview", draft: state.draft });
		expect(state.preview).toEqual(draft);
		expect(state.accepted).toBe(initialWorkshopState.accepted);
		expect(workshopData.connections["connection-1"].status).toBe("tentative");
	});

	const draft = {
		kind: "constraint" as const,
		text: "Keep the contract; no persistent worker.",
	};
	it("keeps the draft and accepted evidence when a generated composition is rejected", () => {
		const editing = workshopReducer(initialWorkshopState, {
			type: "draft",
			draft,
		});
		const rejected = workshopReducer(editing, {
			type: "compose",
			serialized: '{"type":"script"}',
		});
		expect(rejected.accepted).toBe(editing.accepted);
		expect(rejected.draft).toBe(draft);
		expect(rejected.rejection).toContain("preserved");
		expect(initialWorkshopState.draft.text).toBe("");
	});
	it("keeps human input when a valid layout removes and then restores its editor", () => {
		const editing = workshopReducer(initialWorkshopState, {
			type: "draft",
			draft,
		});
		const serialized = JSON.stringify({
			catalogVersion: "0.1.0",
			root: {
				component: "EvidencePair",
				left: workshopData.evidence["source-a"].ref,
				right: workshopData.evidence["source-b"].ref,
			},
		});
		const replaced = workshopReducer(editing, { type: "compose", serialized });
		expect(replaced.accepted).toBe(serialized);
		expect(replaced.draft).toBe(draft);
		const restored = workshopReducer(replaced, {
			type: "compose",
			serialized: initialWorkshopState.accepted,
		});
		expect(restored.draft).toBe(draft);
		expect(restored.accepted).toBe(initialWorkshopState.accepted);
	});
	it("keeps composition feedback separate from decision feedback and clears stale results", () => {
		const previewed = workshopReducer(initialWorkshopState, {
			type: "preview",
			draft,
		});
		const rejected = workshopReducer(previewed, {
			type: "compose",
			serialized: '{"type":"script"}',
		});
		expect(rejected.notice).toBe(previewed.notice);
		expect(rejected.compositionNotice).toBe("");
		const applied = workshopReducer(rejected, {
			type: "compose",
			serialized: initialWorkshopState.accepted,
		});
		expect(applied.rejection).toBe("");
		expect(applied.compositionNotice).toContain("applied");
		expect(applied.notice).toBe(previewed.notice);
		expect(applied.preview).toBe(previewed.preview);
		const rejectedAgain = workshopReducer(applied, {
			type: "compose",
			serialized: "invalid",
		});
		expect(rejectedAgain.compositionNotice).toBe("");
		expect(rejectedAgain.rejection).not.toBe("");
	});
	it("keeps the draft and preview across empty and unavailable states", () => {
		let state = workshopReducer(initialWorkshopState, { type: "draft", draft });
		state = workshopReducer(state, { type: "preview", draft });
		for (const view of ["empty", "unavailable", "comparison"] as const) {
			state = workshopReducer(state, { type: "view", view });
			expect(state.draft).toBe(draft);
			expect(state.preview).toBe(draft);
		}
		expect(state.accepted).toBe(initialWorkshopState.accepted);
	});
	it("never treats an invalid decision as previewed", () => {
		const state = workshopReducer(initialWorkshopState, {
			type: "preview",
			draft: { kind: "constraint", text: " " },
		});
		expect(state.preview).toBeNull();
		expect(state.notice).toContain("Write your decision");
	});
	it("clears decision feedback when its preview is dismissed", () => {
		const previewed = workshopReducer(initialWorkshopState, {
			type: "preview",
			draft,
		});
		const dismissed = workshopReducer(previewed, {
			type: "dismiss-preview",
		});

		expect(dismissed.preview).toBeNull();
		expect(dismissed.notice).toBe("");
	});
});
