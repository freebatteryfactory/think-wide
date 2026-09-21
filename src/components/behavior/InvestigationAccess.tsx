import { useId, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { investigationAddress } from "./workbench";

export function InvestigationAccess({
	onOpen,
}: {
	onOpen: (investigationId: string) => void;
}) {
	const id = useId();
	const [value, setValue] = useState("");
	const [error, setError] = useState("");
	return (
		<section className="editor-card" aria-labelledby={`${id}-heading`}>
			<h2 id={`${id}-heading`}>Already have an investigation ID?</h2>
			<p>
				Paste it here to return to that investigation and its saved decisions.
				The ID is the last part of an investigation's address. Access is checked
				when it opens.
			</p>
			<form
				className="space-y-4"
				onSubmit={(event) => {
					event.preventDefault();
					const investigationId = investigationAddress(value);
					if (!investigationId) {
						setError("Enter a valid investigation ID.");
						return;
					}
					setError("");
					onOpen(investigationId);
				}}
			>
				<div className="form-field">
					<Label htmlFor={id}>Investigation ID</Label>
					<Input
						id={id}
						value={value}
						onChange={(event) => setValue(event.target.value)}
						required
						autoComplete="off"
						spellCheck={false}
						aria-invalid={!!error}
						aria-describedby={`${id}-error`}
					/>
					<p id={`${id}-error`} className="field-error" role="alert">
						{error}
					</p>
				</div>
				<Button type="submit">Open investigation</Button>
			</form>
		</section>
	);
}
