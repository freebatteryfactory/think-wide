import {
	type DecisionDraft,
	validateDecisionText,
} from "#/components/catalog/ConstraintEditor";
import { compositionContext } from "#/components/catalog/registry";
import { validateComposition } from "#/components/catalog/validate-composition";
import { initialComposition, workshopData } from "./fixtures";

type View = "comparison" | "unavailable" | "empty";

type WorkshopState = {
	view: View;
	draft: DecisionDraft;
	preview: DecisionDraft | null;
	accepted: string;
	notice: string;
	compositionNotice: string;
	rejection: string;
};

type WorkshopAction =
	| { type: "view"; view: View }
	| { type: "draft"; draft: DecisionDraft }
	| { type: "preview"; draft: DecisionDraft }
	| { type: "dismiss-preview" }
	| { type: "compose"; serialized: string }
	| { type: "notice"; message: string };

export const initialWorkshopState: WorkshopState = {
	view: "comparison",
	draft: { kind: "constraint", text: "" },
	preview: null,
	accepted: initialComposition,
	notice: "",
	compositionNotice: "",
	rejection: "",
};

// Session-only state. Human drafts survive view replacement and rejection.
// This reducer is not a substitute for durable domain decision transactions.
export function workshopReducer(
	state: WorkshopState,
	action: WorkshopAction,
): WorkshopState {
	switch (action.type) {
		case "view":
			return { ...state, view: action.view };

		case "draft":
			return { ...state, draft: action.draft };

		case "notice":
			return { ...state, notice: action.message };

		case "dismiss-preview":
			return { ...state, preview: null, notice: "" };

		case "preview": {
			const error = validateDecisionText(action.draft.text);

			if (error) {
				return { ...state, notice: error };
			}

			return {
				...state,
				preview: action.draft,
				notice:
					"Decision previewed locally. The sample hypothesis and prepared brief are unchanged.",
			};
		}

		case "compose": {
			const result = validateComposition(
				action.serialized,
				compositionContext(workshopData),
			);

			if (!result.ok) {
				return {
					...state,
					rejection: `${result.reason} Your last valid view and decision draft are preserved.`,
					compositionNotice: "",
				};
			}

			return {
				...state,
				accepted: action.serialized,
				rejection: "",
				compositionNotice:
					state.view === "empty"
						? "Composition accepted. Switch to Comparison to see the layout."
						: "Composition applied to the local preview above.",
			};
		}
	}
}
