import type {
	Decision,
	Handoff,
	Investigation,
	PrepareHandoffRequest,
	Project,
} from "../generated/types";
import {
	Investigation as isInvestigation,
	PrepareHandoffRequest as isPrepareRequest,
	Project as isProject,
} from "../generated/validators.js";
import { HandoffError, projectHandoffDecisions } from "./handoff";
import { canonicalArguments } from "./receipts";

type Projection = Pick<
	Handoff,
	| "investigationId"
	| "investigationRevision"
	| "objective"
	| "targetRepository"
	| "constraints"
	| "evidence"
	| "audience"
>;

/** The prepareHandoff transaction must load/authorize these inputs, verify source
 * existence, and supply its own stored acceptance/scope metadata. This pure step
 * binds the requested revision and target to snapshot data and includes every
 * consumed reference; it never resolves a branch, authorizes, or writes storage.
 */
export function projectHandoffInputs(
	request: PrepareHandoffRequest,
	investigation: Investigation,
	decisions: readonly Decision[],
	target: Project,
): Projection {
	if (
		!isPrepareRequest(request) ||
		!isInvestigation(investigation) ||
		!isProject(target)
	) {
		throw new HandoffError(
			"invalid_request",
			"Invalid handoff projection input",
		);
	}
	if (
		request.investigationId !== investigation.investigationId ||
		request.targetRepositoryId !== target.repositoryId ||
		target.syncStatus === "revoked"
	) {
		throw new HandoffError("not_found", "Resource not found");
	}
	const snapshots = target.snapshots.filter((candidate) =>
		investigation.snapshotIds.includes(candidate.snapshotId),
	);
	if (!snapshots.length) {
		throw new HandoffError("not_found", "Resource not found");
	}
	if (snapshots.length !== 1) {
		throw new HandoffError(
			"invalid_request",
			"The investigation must select one unambiguous target snapshot",
		);
	}
	const snapshot = snapshots[0];
	if (request.expectedRevision !== investigation.revision) {
		throw new HandoffError(
			"revision_conflict",
			"Investigation revision changed",
		);
	}
	if (request.audience !== "private_download") {
		throw new HandoffError(
			"capability_disabled",
			"Issue publication is unavailable",
		);
	}
	const objectIdLength = snapshot.hashAlgorithm === "sha1" ? 40 : 64;
	if (
		investigation.status === "source_unavailable" ||
		snapshot.commit.length !== objectIdLength ||
		snapshot.rootTreeId.length !== objectIdLength
	) {
		throw new HandoffError(
			"source_unavailable",
			"Target snapshot is unavailable or inconsistent",
		);
	}
	const constraints = projectHandoffDecisions(investigation, decisions);
	const evidence: Handoff["evidence"] = [];
	const findings = investigation.acceptedFindings ?? [];
	for (const decision of decisions) {
		if (
			decision.targetFindingId &&
			!findings.some(
				(finding) => finding.findingId === decision.targetFindingId,
			)
		) {
			throw new HandoffError("not_found", "Resource not found");
		}
		for (const ref of decision.refs ?? []) {
			evidence.push({
				ref: structuredClone(ref),
				note: `Human ${decision.kind} decision ${decision.decisionId}`,
			});
		}
	}
	for (const finding of findings) {
		const note = `${finding.evidenceClass} / ${finding.verification}: ${finding.summary}`;
		if ([...note].length > 512) {
			throw new HandoffError(
				"limit_exceeded",
				"Finding and provenance exceed the evidence-note limit; nothing was truncated",
			);
		}
		for (const ref of finding.refs) {
			evidence.push({ ref: structuredClone(ref), note });
		}
	}
	if (evidence.length > 32) {
		throw new HandoffError(
			"limit_exceeded",
			"All consumed evidence cannot fit in the current brief contract",
		);
	}
	for (const { ref } of evidence) {
		if (
			!ref.snapshotId ||
			!investigation.snapshotIds.includes(ref.snapshotId)
		) {
			throw new HandoffError("not_found", "Resource not found");
		}
		if (
			ref.snapshotId === snapshot.snapshotId &&
			(ref.repositoryId !== target.repositoryId ||
				ref.commit !== snapshot.commit ||
				ref.hashAlgorithm !== snapshot.hashAlgorithm)
		) {
			throw new HandoffError(
				"source_unavailable",
				"Evidence does not match the selected target snapshot",
			);
		}
	}
	evidence.sort((a, b) => {
		const left = canonicalArguments(a);
		const right = canonicalArguments(b);
		return left < right ? -1 : left > right ? 1 : 0;
	});
	return {
		investigationId: investigation.investigationId,
		investigationRevision: investigation.revision,
		objective: investigation.question,
		targetRepository: {
			repositoryId: target.repositoryId,
			baseCommit: snapshot.commit,
			hashAlgorithm: snapshot.hashAlgorithm,
		},
		constraints,
		evidence,
		audience: request.audience,
	};
}
