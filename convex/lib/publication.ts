import { ConvexError } from "convex/values";
import { may } from "../../core";
import type {
	Finding,
	Investigation,
	Proposal,
	Run,
} from "../../generated/types";
import * as validators from "../../generated/validators.js";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { AuthorizedCtx } from "./authz";
import { decode, fail, validate } from "./validation";

/** Internal only. Rejection is a returned outcome so superseded is committed;
 * throwing after patching would roll back the fence status in Convex.
 */
export async function publishRun(
	ctx: MutationCtx,
	args: { request: unknown },
): Promise<{ published: boolean; status: Run["status"] }> {
	if (Object.keys(args).length !== 1)
		fail("invalid_request", "Expected a single request argument");
	const proposal = validate<Proposal>(validators.Proposal, args.request);
	if (!proposal.runId)
		fail("invalid_request", "Publication requires a run id", {
			details: [{ path: "/runId", problem: "Required for publication" }],
		});
	const id = ctx.db.normalizeId("runs", proposal.runId);
	const row = id && (await ctx.db.get(id));
	if (!row) return fail("not_found", "Resource not found");
	return publishAuthorizedRun(
		ctx,
		new AuthorizedCtx(ctx, { id: row.principal }, "requestAnalysis"),
		proposal,
		row,
	);
}

/** Shared transactional publication primitive. Public submission supplies its
 * verified authorized context; only the internal entry point derives a run owner. */
export async function publishAuthorizedRun(
	ctx: MutationCtx,
	authorized: AuthorizedCtx,
	proposal: Proposal,
	row: Doc<"runs">,
): Promise<{ published: boolean; status: Run["status"] }> {
	const run = decode<Run>(validators.Run, row.body);
	if (
		proposal.investigationId !== run.investigationId ||
		proposal.baseRevision !== run.baseRevision
	)
		fail("invalid_request", "Proposal does not match admitted run");
	if (run.status !== "admitted" && run.status !== "running")
		return { published: false, status: run.status };
	const supersede = async () => {
		await ctx.db.patch(row._id, {
			body: JSON.stringify({
				...run,
				status: "superseded",
				finishedAt: Date.now(),
			}),
		});
		return { published: false, status: "superseded" as const };
	};
	for (const fence of row.fences) {
		const grant = await ctx.db.get(fence.grantId);
		if (
			!grant ||
			grant.principal !== row.principal ||
			grant.epoch !== fence.epoch ||
			grant.revokedAt !== undefined ||
			may(
				{ id: row.principal },
				authorized.operationId,
				{ kind: grant.resourceKind, id: grant.resourceId },
				[grant],
			) !== "allow"
		)
			return supersede();
	}
	try {
		const parent = await authorized.loadAuthorized(
			"investigation",
			run.investigationId,
		);
		const investigation = decode<Investigation>(
			validators.Investigation,
			parent.body,
		);
		if (investigation.revision !== run.baseRevision) return supersede();
		if (proposal.composition)
			fail("unsupported", "Composition publication is not supported");
		for (const claim of proposal.claims)
			await authorized.authorizeRefs(claim.refs, investigation);
		// Publication must retain exactly the investigation and snapshot fence set.
		if (authorized.fences().length !== row.fences.length) return supersede();
		for (const fence of authorized.fences())
			if (
				!row.fences.some(
					(admitted) =>
						admitted.grantId === fence.grantId &&
						admitted.epoch === fence.epoch,
				)
			)
				return supersede();
		const findings: Finding[] = proposal.claims.map((claim, index) => ({
			findingId: `${run.runId}:${index}`,
			summary: claim.statement,
			evidenceClass: claim.evidenceClass,
			refs: claim.refs,
			...(claim.unknowns !== undefined ? { unknowns: claim.unknowns } : {}),
			verification: "unverified",
			observedAt: Date.now(),
		}));
		for (const finding of findings) {
			if (Array.from(finding.summary).length > 512)
				fail("limit_exceeded", "Finding summary exceeds 512 characters");
			validate(validators.Finding, finding);
		}
		const updated: Investigation = {
			...investigation,
			acceptedFindings: [
				...(investigation.acceptedFindings ?? []),
				...findings,
			],
			status: "awaiting_human",
		};
		if ((updated.acceptedFindings?.length ?? 0) > 64)
			fail("limit_exceeded", "Investigation finding limit reached");
		validate(validators.Investigation, updated, true);
		if (new TextEncoder().encode(JSON.stringify(updated)).length > 14000)
			fail("limit_exceeded", "Published findings exceed response limit");
		const decisions = await authorized.queryAuthorized(
			run.investigationId,
			0,
			1025,
		);
		if (decisions.length > 1024)
			fail("limit_exceeded", "Publication input exceeds decision limit");
		for (const decision of decisions)
			if (
				new TextEncoder().encode(
					JSON.stringify({ ...updated, decisions: [decision] }),
				).length > 15000
			)
				fail(
					"limit_exceeded",
					"Published findings would exceed a decision page limit",
				);
		await ctx.db.patch(parent._id, { body: JSON.stringify(updated) });
		const finished: Run = {
			...run,
			status: "published",
			finishedAt: Date.now(),
		};
		validate(validators.Run, finished, true);
		await ctx.db.patch(row._id, { body: JSON.stringify(finished) });
		return { published: true, status: "published" };
	} catch (error) {
		if (
			error instanceof ConvexError &&
			typeof error.data === "object" &&
			error.data !== null &&
			"code" in error.data &&
			error.data.code === "not_found"
		)
			return supersede();
		throw error;
	}
}
