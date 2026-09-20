import { ConvexError } from "convex/values";
import type {
	Decision,
	Investigation,
	OperationError,
	RecordDecisionRequest,
	SourceRef,
} from "../../../generated/types";
import {
	RecordDecisionRequest as isDecisionRequest,
	Investigation as isInvestigation,
	OperationError as isOperationError,
	ReadInvestigationRequest as isReadInvestigationRequest,
} from "../../../generated/validators.js";

export const decisionLabels = {
	correction: "Correction",
	constraint: "Constraint",
	rejection: "Rejection",
	acceptance: "Acceptance",
} satisfies Record<RecordDecisionRequest["kind"], string>;

export type DecisionDraft = Pick<
	RecordDecisionRequest,
	"kind" | "statement" | "category"
>;

export function isDecisionKind(
	value: string,
): value is RecordDecisionRequest["kind"] {
	return Object.hasOwn(decisionLabels, value);
}

export function decisionCommand(
	investigation: Pick<Investigation, "investigationId" | "revision">,
	draft: DecisionDraft,
	requestKey: string,
	refs: readonly SourceRef[] = [],
): RecordDecisionRequest {
	const request = {
		investigationId: investigation.investigationId,
		expectedRevision: investigation.revision,
		kind: draft.kind,
		statement: draft.statement,
		...(draft.category === undefined ? {} : { category: draft.category }),
		requestKey,
		...(refs.length ? { refs: structuredClone(refs) } : {}),
	};
	if (!draft.statement.trim() || !isDecisionRequest(request)) {
		throw new Error(
			"Enter a decision within the contract’s 16,384 character limit.",
		);
	}
	return request as RecordDecisionRequest;
}

export function investigationAddress(value: string): string | undefined {
	const investigationId = value.trim();
	return isReadInvestigationRequest({ investigationId })
		? investigationId
		: undefined;
}

/** Only expose validated public errors; transport exceptions may contain URLs or payloads. */
export function operationError(error: unknown): OperationError | undefined {
	if (!(error instanceof ConvexError)) {
		return undefined;
	}
	let data: unknown = error.data;
	if (typeof data === "string") {
		try {
			data = JSON.parse(data);
		} catch {
			return undefined;
		}
	}
	return isOperationError(data) ? (data as OperationError) : undefined;
}

export function workbenchError(error: unknown): string {
	const failure = operationError(error);
	switch (failure?.code) {
		case "unauthenticated":
			return "Sign in through the configured connection to open this investigation.";
		case "not_found":
		case "forbidden":
			return "Investigation unavailable.";
		case "revision_conflict":
			return "A newer revision exists. Your draft is unchanged. Review the latest decisions before saving again.";
		case "cursor_invalid":
			return "The investigation changed. Reload its decision history.";
		case "limit_exceeded":
			return "This result exceeds the current size limit. Nothing was truncated or saved.";
		default:
			return failure
				? "The operation was rejected. Your draft is unchanged."
				: "The operation could not be confirmed. Retry the same save to check its receipt.";
	}
}

/** Refuse mixed revisions and overlapping pages rather than silently dropping history. */
export function appendDecisionPage(
	current: readonly Decision[],
	page: Investigation,
	expected: Pick<Investigation, "investigationId" | "revision">,
): Decision[] {
	if (!isInvestigation(page)) {
		throw new Error("Invalid investigation page");
	}
	if (
		page.investigationId !== expected.investigationId ||
		page.revision !== expected.revision
	) {
		throw new Error("Investigation revision changed");
	}
	const next = [...current, ...(page.decisions ?? [])];
	if (
		next.length > expected.revision ||
		(!!page.page?.nextCursor &&
			(!page.decisions?.length ||
				!page.page.truncated.is ||
				next.length >= expected.revision)) ||
		next.some(
			(decision, index) =>
				decision.investigationId !== expected.investigationId ||
				decision.madeAtRevision !== index ||
				decision.resultingRevision !== index + 1,
		) ||
		new Set(next.map((decision) => decision.decisionId)).size !== next.length ||
		(!page.page?.nextCursor &&
			(page.page?.truncated.is || next.length !== expected.revision))
	) {
		throw new Error("Decision history is incomplete");
	}
	return next;
}
