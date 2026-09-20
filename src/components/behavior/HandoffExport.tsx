import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../ui/button";
import {
	type HandoffReader,
	type HandoffSelection,
	readHandoffExport,
} from "./handoff-export";

/** The saved-handoff route supplies the protected read operation. */
export function HandoffExport({
	selection,
	read,
}: {
	selection: HandoffSelection;
	read: HandoffReader;
}) {
	const id = useId();
	const busy = useRef(false);
	const mounted = useRef(false);
	const currentSelection = useRef(selection);
	currentSelection.current = selection;
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const [exporting, setExporting] = useState(false);
	const [message, setMessage] = useState("");

	async function exportBrief(format: "copy" | "download") {
		if (busy.current) {
			return;
		}
		busy.current = true;
		setExporting(true);
		setMessage("");
		try {
			const result = await readHandoffExport(selection, read);
			if (
				!mounted.current ||
				currentSelection.current.handoffId !== selection.handoffId ||
				currentSelection.current.handoffRevision !==
					selection.handoffRevision ||
				currentSelection.current.bodyHash !== selection.bodyHash
			) {
				return;
			}
			if (format === "copy") {
				await navigator.clipboard.writeText(result.bodyMarkdown);
				setMessage("Verified brief copied. Its SHA-256 is shown below.");
			} else {
				const url = URL.createObjectURL(
					new Blob([result.bodyMarkdown], {
						type: "text/markdown;charset=utf-8",
						endings: "transparent",
					}),
				);
				const link = document.createElement("a");
				link.href = url;
				link.download = result.filename;
				document.body.append(link);
				try {
					link.click();
					setMessage("Verified brief download started.");
				} finally {
					link.remove();
					setTimeout(() => URL.revokeObjectURL(url), 0);
				}
			}
		} catch {
			// No raw provider, authorization, or clipboard exception text enters UI.
			setMessage(
				"Export could not be completed. Reopen the saved brief and check your connection and access, then try again.",
			);
		} finally {
			busy.current = false;
			setExporting(false);
		}
	}

	return (
		<section className="handoff-card" aria-labelledby={`${id}-heading`}>
			<h2 id={`${id}-heading`}>Export saved implementation brief</h2>
			<p>Revision {selection.handoffRevision} · private download</p>
			<p className="field-help">
				Each export checks current access and verifies the exact saved text.
			</p>
			<div className="flex flex-wrap gap-3">
				<Button
					type="button"
					disabled={exporting}
					onClick={() => void exportBrief("download")}
				>
					Download Markdown
				</Button>
				<Button
					type="button"
					variant="outline"
					disabled={exporting}
					onClick={() => void exportBrief("copy")}
				>
					Copy Markdown
				</Button>
				<Button
					type="button"
					variant="outline"
					disabled
					aria-describedby={`${id}-publication`}
				>
					Publish GitHub issue
				</Button>
			</div>
			<p id={`${id}-publication`} className="field-help">
				Issue publication is not connected.
			</p>
			<p className="break-all font-mono text-sm">
				SHA-256: {selection.bodyHash}
			</p>
			<output className="block" aria-live="polite">
				{message}
			</output>
		</section>
	);
}
