import type {
	Decision,
	Handoff,
	Investigation,
	OperationError,
} from "../generated/types";
import {
	Decision as isDecision,
	Handoff as isHandoff,
} from "../generated/validators.js";
import { canonicalArguments } from "./receipts";

export class HandoffError extends Error {
	constructor(
		readonly code: OperationError["code"],
		message: string,
	) {
		super(message);
		this.name = "HandoffError";
	}
}

export type HandoffInput = Omit<Handoff, "bodyMarkdown" | "bodyHash">;

// Literal blocks preserve human/source text without allowing it to add Markdown
// headings, links, HTML, or close the surrounding fence. No source quotes are inferred.
function literal(value: string): string {
	const runs = value.match(/`+/g) ?? [];
	const fence = "`".repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
	return `${fence}text\n${value}\n${fence}`;
}

function literalJson(value: unknown): string {
	try {
		return literal(
			JSON.stringify(JSON.parse(canonicalArguments(value)), null, 2),
		);
	} catch {
		throw new HandoffError(
			"invalid_request",
			"Brief contains unsupported JSON values",
		);
	}
}

/** Hash the bytes that a UTF-8 download will contain, refusing lossy conversion. */
export async function handoffBodyHash(body: string): Promise<string> {
	const bytes = new TextEncoder().encode(body);
	if (
		new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) !==
		body
	) {
		throw new HandoffError(
			"invalid_request",
			"Brief text cannot be represented exactly as UTF-8",
		);
	}
	const hash = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(hash), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

/** Integrity is not authorization. Call only after a fresh authorized read. */
export async function verifyHandoffBody(value: unknown): Promise<Handoff> {
	if (!isHandoff(value)) {
		throw new HandoffError("invalid_request", "Invalid saved brief");
	}
	const handoff = structuredClone(value) as Handoff;
	if ((await handoffBodyHash(handoff.bodyMarkdown)) !== handoff.bodyHash) {
		throw new HandoffError(
			"source_unavailable",
			"Brief hash mismatch; export refused",
		);
	}
	return handoff;
}

/** Project a complete authorized decision ledger, never just a response page.
 * The caller must authorize the investigation and every consumed ref first.
 * Acceptance decisions remain in the ledger section; they are not test results.
 */
export function projectHandoffDecisions(
	investigation: Pick<Investigation, "investigationId" | "revision">,
	decisions: readonly Decision[],
): Handoff["constraints"] {
	const ordered = [...decisions].sort(
		(a, b) => a.resultingRevision - b.resultingRevision,
	);
	if (
		ordered.length !== investigation.revision ||
		new Set(ordered.map((decision) => decision.decisionId)).size !==
			ordered.length ||
		ordered.some(
			(decision, index) =>
				!isDecision(decision) ||
				decision.investigationId !== investigation.investigationId ||
				decision.madeAtRevision !== index ||
				decision.resultingRevision !== index + 1,
		)
	)
		throw new HandoffError(
			"revision_conflict",
			"A complete decision ledger at the selected revision is required",
		);
	// Every human decision reaches the structured brief, acceptance included: a specialist
	// reading `constraints` must see what was already agreed, with its category.
	const constraints: Handoff["constraints"] = ordered.map((decision) => ({
		decisionId: decision.decisionId,
		statement: decision.statement,
		...(decision.category === undefined ? {} : { category: decision.category }),
		kind: decision.kind === "rejection" ? "rejected_approach" : decision.kind,
	}));
	if (constraints.length > 32)
		throw new HandoffError(
			"limit_exceeded",
			"The brief cannot hold every human constraint; none were dropped",
		);
	return constraints;
}

/** Deterministic private brief formatter. This does not authorize, persist, or
 * publish a handoff. The eventual prepareHandoff transaction supplies validated
 * metadata, exact refs, and all decisions at its checked expectedRevision.
 * bodyHash is SHA-256 of the exact UTF-8 body; it is stored beside the body to
 * avoid a circular hash. Bounded body reads let callers export larger briefs.
 */
export async function freezeHandoff(
	input: HandoffInput,
	decisions: readonly Decision[],
): Promise<Handoff> {
	// Snapshot the caller's data before the asynchronous digest.
	const handoff: Handoff = structuredClone({
		...input,
		bodyMarkdown: "pending",
		bodyHash: "0".repeat(64),
	});
	if (!isHandoff(handoff))
		throw new HandoffError("invalid_request", "Invalid handoff fields");
	if (
		handoff.audience !== "private_download" ||
		handoff.publication.status !== "prepared" ||
		handoff.publication.issueUrl !== undefined ||
		handoff.publication.receiptId !== undefined
	)
		throw new HandoffError(
			"capability_disabled",
			"Issue publication is unavailable; prepare a private download",
		);
	const constraints = projectHandoffDecisions(
		{
			investigationId: handoff.investigationId,
			revision: handoff.investigationRevision,
		},
		decisions,
	);
	if (
		handoff.constraints.length !== constraints.length ||
		handoff.constraints.some(
			(constraint, index) =>
				constraint.decisionId !== constraints[index].decisionId ||
				constraint.statement !== constraints[index].statement ||
				constraint.kind !== constraints[index].kind ||
				constraint.category !== constraints[index].category,
		)
	)
		throw new HandoffError(
			"invalid_request",
			"Brief constraints must preserve the complete human decision ledger",
		);
	if (handoff.acceptance.some((item) => item.status !== "not_run"))
		throw new HandoffError(
			"invalid_request",
			"Preparing a brief cannot claim specialist or CI results",
		);
	for (const ref of [
		...handoff.evidence.map((evidence) => evidence.ref),
		...decisions.flatMap((decision) => decision.refs ?? []),
	]) {
		const length = ref.hashAlgorithm === "sha1" ? 40 : 64;
		if (
			!ref.snapshotId ||
			!Number.isSafeInteger(ref.byteRange.start) ||
			!Number.isSafeInteger(ref.byteRange.end) ||
			ref.byteRange.end < ref.byteRange.start ||
			(ref.lineRange && ref.lineRange.end < ref.lineRange.start) ||
			ref.commit.length !== length ||
			ref.blobId.length !== length
		)
			throw new HandoffError(
				"source_unavailable",
				"An exact snapshot-bound reference is required",
			);
	}
	const sections = [
		"# Implementation brief",
		`Handoff: ${handoff.handoffId} · revision ${handoff.handoffRevision}`,
		`Investigation: ${handoff.investigationId} · revision ${handoff.investigationRevision}`,
		"Audience: private download. Issue publication is unavailable.",
		"## Objective",
		literal(handoff.objective),
		"## Target repository and base commit",
		literalJson(handoff.targetRepository),
		"## Allowed scope",
		literal(
			handoff.allowedScope ?? "Not specified; resolve before implementation.",
		),
		"## Excluded changes",
		literal(
			handoff.excludedChanges ??
				"Not specified; resolve before implementation.",
		),
		"## Human decisions (append-only)",
		...[...decisions]
			.sort((a, b) => a.resultingRevision - b.resultingRevision)
			.flatMap((decision) => [
				`### Revision ${decision.resultingRevision}: ${decision.kind}`,
				literalJson(decision),
			]),
		...(decisions.length ? [] : ["No human decisions recorded."]),
		"## Constraints and rejected approaches",
		literalJson(handoff.constraints),
		"## Exact evidence references",
		"References retain exact byte ranges and digests. This formatter does not verify source availability or reconstruct quotations.",
		literalJson(handoff.evidence),
		"## Likely files (suggestions)",
		literalJson(handoff.likelyFiles ?? []),
		"## Uncertainties",
		literalJson(handoff.uncertainties ?? []),
		"## Acceptance (not run)",
		literalJson(handoff.acceptance),
		"## Execution boundary",
		"Think-Wide supplies evidence and this brief. Implementation and testing belong to the specialist; Think-Wide has not run target code.",
	];
	handoff.bodyMarkdown = `${sections.join("\n\n")}\n`;
	if (handoff.bodyMarkdown.length > 65536)
		throw new HandoffError(
			"limit_exceeded",
			"Brief exceeds the contract body limit; nothing was truncated",
		);
	handoff.bodyHash = await handoffBodyHash(handoff.bodyMarkdown);
	if (!isHandoff(handoff))
		throw new HandoffError("invalid_request", "Invalid prepared handoff");
	return handoff;
}
