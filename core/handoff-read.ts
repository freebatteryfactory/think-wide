import type {
	Handoff,
	HandoffBodyWindow,
	HandoffSummary,
	ReadHandoffRequest,
} from "../generated/types";
import { HandoffError } from "./handoff";

export function handoffSummary(value: Handoff): HandoffSummary {
	return {
		handoffId: value.handoffId,
		handoffRevision: value.handoffRevision,
		investigationId: value.investigationId,
		investigationRevision: value.investigationRevision,
		targetRepository: value.targetRepository,
		audience: value.audience,
		bodyHash: value.bodyHash,
		bodyByteLength: new TextEncoder().encode(value.bodyMarkdown).length,
		preparedAt: value.preparedAt,
	};
}

/** 2 KiB raw windows also fit the 16 KiB response cap with JSON escaping. */
export function handoffBodyWindow(
	value: Handoff,
	request: ReadHandoffRequest,
): HandoffBodyWindow {
	const bytes = new TextEncoder().encode(value.bodyMarkdown);
	const range = request.byteRange;
	if (
		!range ||
		!Number.isSafeInteger(range.start) ||
		!Number.isSafeInteger(range.end) ||
		range.start < 0 ||
		range.end < range.start ||
		range.end > bytes.length ||
		(bytes[range.start] & 0xc0) === 0x80 ||
		(bytes[range.end] & 0xc0) === 0x80
	) {
		throw new HandoffError(
			"invalid_request",
			"Select a valid UTF-8 body range",
		);
	}
	let end = Math.min(range.end, range.start + 2048);
	while (end > range.start && (bytes[end] & 0xc0) === 0x80) {
		end--;
	}
	return {
		handoffId: value.handoffId,
		handoffRevision: value.handoffRevision,
		bodyHash: value.bodyHash,
		bodyByteLength: bytes.length,
		byteRange: { start: range.start, end },
		content: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
			bytes.subarray(range.start, end),
		),
		nextRange: end < range.end ? { start: end, end: range.end } : null,
	};
}
