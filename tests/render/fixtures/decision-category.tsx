import { useState } from "react";
import { createRoot } from "react-dom/client";
import { DecisionEditor } from "../../../src/components/behavior/DecisionEditor";
import {
	type DecisionDraft,
	decisionCommand,
} from "../../../src/components/behavior/workbench";

/** Isolated real editor; parent-owned state, no backend or mocked authorization. */
function CategoryHarness() {
	const [draft, setDraft] = useState<DecisionDraft>({
		kind: "constraint",
		statement: "",
	});
	const [visible, setVisible] = useState(true);
	const [request, setRequest] = useState("");
	return (
		<>
			{visible ? (
				<DecisionEditor
					draft={draft}
					onDraftChange={setDraft}
					onSave={() =>
						setRequest(
							JSON.stringify(
								decisionCommand(
									{ investigationId: "investigation", revision: 0 },
									draft,
									"category-browser-request",
								),
							),
						)
					}
					locked={false}
					saveDisabled={false}
					submitLabel="Save decision"
					message=""
				/>
			) : null}
			<button type="button" onClick={() => setVisible(!visible)}>
				Toggle editor
			</button>
			<output aria-label="Submitted request">{request}</output>
		</>
	);
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing test root");
createRoot(root).render(<CategoryHarness />);
