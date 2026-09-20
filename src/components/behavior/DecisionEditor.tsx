import { useId } from "react";
import type { RecordDecisionRequest } from "../../../generated/types";
import { DECISION_EDITOR_HEADING } from "../catalog/ConstraintEditor";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import {
	decisionCategoryLabels,
	decisionLabels,
	isDecisionKind,
} from "./workbench";

type Draft = Pick<RecordDecisionRequest, "kind" | "statement" | "category">;

function isDecisionCategory(
	value: string,
): value is NonNullable<Draft["category"]> {
	return Object.hasOwn(decisionCategoryLabels, value);
}
type DecisionEditorProps = {
	draft: Draft;
	onDraftChange: (draft: Draft) => void;
	onSave: () => void;
	locked: boolean;
	saveDisabled: boolean;
	submitLabel: string;
	message: string;
	review?: { revision: number; onConfirm: () => void };
};

/** Persistent behavior uses T03's reviewed heading and shadcn/theme primitives.
 * The parent owns the exact draft; a model view, reset or retry cannot replace it.
 * The workshop's preview-only editor remains unchanged.
 */
export function DecisionEditor({
	draft,
	onDraftChange,
	onSave,
	locked,
	saveDisabled,
	submitLabel,
	message,
	review,
}: DecisionEditorProps) {
	const id = useId();
	return (
		<section className="editor-card" aria-labelledby={`${id}-heading`}>
			<span className="eyebrow">Human direction</span>
			<h2 id={`${id}-heading`}>{DECISION_EDITOR_HEADING}</h2>
			<form
				className="space-y-4"
				onSubmit={(event) => {
					event.preventDefault();
					if (!saveDisabled) {
						onSave();
					}
				}}
			>
				<fieldset disabled={locked} className="space-y-4">
					<div className="form-field">
						<Label htmlFor={`${id}-kind`}>Decision action</Label>
						<select
							id={`${id}-kind`}
							value={draft.kind}
							onChange={(event) => {
								if (isDecisionKind(event.target.value)) {
									onDraftChange({ ...draft, kind: event.target.value });
								}
							}}
						>
							{Object.entries(decisionLabels).map(([kind, label]) => (
								<option key={kind} value={kind}>
									{label}
								</option>
							))}
						</select>
					</div>
					<div className="form-field">
						<Label htmlFor={`${id}-category`}>Category (optional)</Label>
						<select
							id={`${id}-category`}
							value={draft.category ?? ""}
							onChange={(event) => {
								const value = event.target.value;
								if (value === "") {
									const next = { ...draft };
									delete next.category;
									onDraftChange(next);
								} else if (isDecisionCategory(value)) {
									onDraftChange({ ...draft, category: value });
								}
							}}
						>
							<option value="">Uncategorized</option>
							{Object.entries(decisionCategoryLabels).map(
								([category, label]) => (
									<option key={category} value={category}>
										{label}
									</option>
								),
							)}
						</select>
					</div>
					<div className="form-field">
						<Label htmlFor={`${id}-statement`}>Your direction</Label>
						<Textarea
							id={`${id}-statement`}
							rows={5}
							maxLength={16384}
							required
							value={draft.statement}
							aria-describedby={`${id}-help`}
							onChange={(event) =>
								onDraftChange({ ...draft, statement: event.target.value })
							}
						/>
						<p id={`${id}-help`} className="field-help">
							Saved decisions survive reopening. Unsaved drafts stay here until
							you navigate away or reload.
						</p>
					</div>
				</fieldset>
				{review ? (
					<div className="space-y-2">
						<p>
							A newer revision is available. Review the saved history before
							applying your draft.
						</p>
						<Button type="button" variant="outline" onClick={review.onConfirm}>
							I reviewed revision {review.revision}
						</Button>
					</div>
				) : null}
				<Button type="submit" disabled={saveDisabled}>
					{submitLabel}
				</Button>
				<output className="block field-help" aria-live="polite">
					{message}
				</output>
			</form>
		</section>
	);
}
