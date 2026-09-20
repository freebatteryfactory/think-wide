import {
	HandoffError,
	handoffBodyHash,
	verifyHandoffBody,
} from "../../../core/handoff";
import type {
	Handoff,
	HandoffRead,
	ReadHandoffRequest,
} from "../../../generated/types";
import {
	HandoffRead as isRead,
	HandoffSummary as isSummary,
} from "../../../generated/validators.js";

export type HandoffSelection = Pick<
	Handoff,
	"handoffId" | "handoffRevision" | "bodyHash"
>;
export type HandoffReader = (
	request: ReadHandoffRequest,
) => Promise<HandoffRead>;

/** Every export starts with a protected read, and every window reauthorizes the
 * complete saved brief. Only a complete, hash-verified body can leave the app. */
export async function readHandoffExport(
	selection: HandoffSelection,
	read: HandoffReader,
) {
	const selected = { ...selection };
	const pinned = {
		handoffId: selected.handoffId,
		handoffRevision: selected.handoffRevision,
	};
	const initial = await read({ ...pinned, detail: "summary" });
	if (
		!isRead(initial) ||
		initial.handoffId !== selected.handoffId ||
		initial.handoffRevision !== selected.handoffRevision ||
		initial.bodyHash !== selected.bodyHash
	) {
		throw new HandoffError(
			"revision_conflict",
			"The saved brief changed; reopen it before exporting",
		);
	}
	if (!("audience" in initial) || initial.audience !== "private_download") {
		throw new HandoffError(
			"capability_disabled",
			"Only private download briefs can be exported here",
		);
	}
	let bodyMarkdown: string;
	if ("bodyMarkdown" in initial) {
		bodyMarkdown = (await verifyHandoffBody(initial)).bodyMarkdown;
	} else {
		if (!isSummary(initial)) {
			throw new HandoffError("invalid_request", "Invalid saved brief summary");
		}
		const chunks: string[] = [];
		let offset = 0;
		while (offset < initial.bodyByteLength) {
			const page = await read({
				...pinned,
				detail: "body",
				byteRange: { start: offset, end: initial.bodyByteLength },
			});
			if (
				!isRead(page) ||
				!("content" in page) ||
				page.handoffId !== selected.handoffId ||
				page.handoffRevision !== selected.handoffRevision ||
				page.bodyHash !== selected.bodyHash ||
				page.bodyByteLength !== initial.bodyByteLength ||
				page.byteRange.start !== offset ||
				page.byteRange.end <= offset ||
				page.byteRange.end > initial.bodyByteLength ||
				new TextEncoder().encode(page.content).length !==
					page.byteRange.end - offset ||
				(page.byteRange.end < initial.bodyByteLength
					? page.nextRange?.start !== page.byteRange.end ||
						page.nextRange?.end !== initial.bodyByteLength
					: page.nextRange !== null)
			) {
				throw new HandoffError(
					"source_unavailable",
					"Invalid or incomplete brief window",
				);
			}
			chunks.push(page.content);
			offset = page.byteRange.end;
			if (chunks.length > 256) {
				throw new HandoffError("limit_exceeded", "Too many brief windows");
			}
		}
		bodyMarkdown = chunks.join("");
		if ((await handoffBodyHash(bodyMarkdown)) !== selected.bodyHash) {
			throw new HandoffError(
				"source_unavailable",
				"Brief hash mismatch; export refused",
			);
		}
	}
	return {
		bodyMarkdown,
		bodyHash: selected.bodyHash,
		filename: `think-wide-${selected.handoffId}-r${selected.handoffRevision}.md`,
	};
}
