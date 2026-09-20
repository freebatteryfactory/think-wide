import {
	freezeHandoff,
	HandoffError,
	verifyHandoffBody,
} from "../../core/handoff";
import { projectHandoffInputs } from "../../core/handoff-projection";
import { handoffBodyWindow, handoffSummary } from "../../core/handoff-read";
import type {
	Handoff,
	HandoffRead,
	HandoffSummary,
	Investigation,
	PrepareHandoffRequest,
	Project,
	ReadHandoffRequest,
} from "../../generated/types";
import * as validators from "../../generated/validators.js";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { AuthorizedCtx } from "./authz";
import { decode, fail } from "./validation";

export async function handoffFailure<T>(invoke: () => Promise<T>): Promise<T> {
	try {
		return await invoke();
	} catch (error) {
		if (error instanceof HandoffError) {
			return fail(error.code, error.message);
		}
		throw error;
	}
}

/** Protected storage access stays inside convex/lib. A handoff inherits its
 * investigation and all consumed snapshot grants; there is no handoff grant. */
export class HandoffAccess {
	constructor(
		private readonly raw: QueryCtx,
		private readonly auth: AuthorizedCtx,
	) {}

	async load(id: string): Promise<Handoff> {
		const normalized = this.raw.db.normalizeId("handoffs", id);
		const row = normalized && (await this.raw.db.get(normalized));
		if (!row) {
			return fail("not_found", "Resource not found");
		}
		const investigation = await this.auth.investigation(row.investigationId);
		const value = decode<Handoff>(validators.Handoff, row.body);
		if (
			value.handoffId !== id ||
			value.investigationId !== row.investigationId
		) {
			return fail("internal", "Invalid stored brief");
		}
		for (const snapshotId of row.snapshotIds) {
			await this.auth.loadAuthorized("snapshot", snapshotId);
		}
		await this.auth.authorizeRefs(
			value.evidence.map(({ ref }) => ref),
			investigation,
		);
		await this.verifySources(value);
		return handoffFailure(() => verifyHandoffBody(value));
	}

	async verifySources(value: Pick<Handoff, "evidence">): Promise<void> {
		for (const { ref } of value.evidence) {
			if (!ref.snapshotId) {
				return fail("source_unavailable", "Snapshot binding required");
			}
			if (ref.byteRange.end - ref.byteRange.start > 16384) {
				return fail(
					"limit_exceeded",
					"Brief evidence must use windows of at most 16 KiB",
				);
			}
			const evidence = await this.auth.sources.read({
				snapshotId: ref.snapshotId,
				entryId: ref.entryId,
				byteRange: ref.byteRange,
			});
			if (
				evidence.rangeAdjusted ||
				evidence.ref.digest !== ref.digest ||
				evidence.ref.repositoryId !== ref.repositoryId ||
				evidence.ref.commit !== ref.commit ||
				evidence.ref.blobId !== ref.blobId ||
				evidence.ref.hashAlgorithm !== ref.hashAlgorithm ||
				evidence.ref.byteRange.start !== ref.byteRange.start ||
				evidence.ref.byteRange.end !== ref.byteRange.end
			) {
				return fail(
					"source_unavailable",
					"Frozen evidence is unavailable or inconsistent",
				);
			}
		}
	}

	async summary(id: string): Promise<HandoffSummary> {
		return handoffSummary(await this.load(id));
	}

	async read(request: ReadHandoffRequest): Promise<HandoffRead> {
		const value = await this.load(request.handoffId);
		if (
			request.handoffRevision !== undefined &&
			request.handoffRevision !== value.handoffRevision
		) {
			return fail("not_found", "Resource not found");
		}
		if (request.detail === "summary") {
			return handoffSummary(value);
		}
		if (request.detail === "body") {
			return handoffFailure(async () => handoffBodyWindow(value, request));
		}
		return value;
	}
}

export async function createHandoff(
	raw: MutationCtx,
	auth: AuthorizedCtx,
	request: PrepareHandoffRequest,
): Promise<string> {
	return handoffFailure(async () => {
		const parent = await auth.loadAuthorized(
			"investigation",
			request.investigationId,
		);
		const investigation = decode<Investigation>(
			validators.Investigation,
			parent.body,
		);
		if (investigation.revision !== request.expectedRevision) {
			return fail("revision_conflict", "Investigation revision changed", {
				currentRevision: investigation.revision,
			});
		}
		if (request.audience !== "private_download") {
			return fail("capability_disabled", "Issue publication is unavailable");
		}
		if (investigation.revision > 256) {
			return fail(
				"limit_exceeded",
				"Brief preparation supports at most 256 decisions; none were omitted",
			);
		}
		const decisions = await auth.queryAuthorized(
			request.investigationId,
			0,
			257,
		);
		let target: Project | undefined;
		for (const snapshotId of investigation.snapshotIds) {
			const row = await auth.loadAuthorized("snapshot", snapshotId);
			const project = decode<Project>(validators.Project, row.project);
			if (project.repositoryId === request.targetRepositoryId) {
				if (target) {
					return fail(
						"invalid_request",
						"Select one unambiguous target snapshot per repository",
					);
				}
				target = project;
			}
		}
		if (!target) {
			return fail("not_found", "Resource not found");
		}
		const projection = projectHandoffInputs(
			request,
			investigation,
			decisions,
			target,
		);
		await auth.authorizeRefs(
			projection.evidence.map(({ ref }) => ref),
			investigation,
		);
		await auth.handoffs.verifySources(projection);
		const id = await raw.db.insert("handoffs", {
			investigationId: parent._id,
			snapshotIds: investigation.snapshotIds,
			body: "",
		});
		const handoff = await freezeHandoff(
			{
				...projection,
				handoffId: id,
				handoffRevision: 1,
				preparedAt: Date.now(),
				publication: { status: "prepared" },
				allowedScope:
					"Follow the recorded objective and human decision ledger. File-level scope is unspecified and must be confirmed before implementation.",
				excludedChanges:
					"No target repository execution, dependency installation, modification, deployment or issue publication by Think-Wide.",
				uncertainties: [
					"Suggested implementation details and file-level scope require specialist review.",
					"Source evidence does not establish that an implementation passes tests.",
				],
				acceptance: [
					{
						behavior:
							"A specialist verifies the objective and every recorded human constraint against the target base commit.",
						status: "not_run",
					},
				],
			},
			decisions,
		);
		await raw.db.patch(id, { body: JSON.stringify(handoff) });
		return id;
	});
}
