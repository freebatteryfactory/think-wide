import type { Principal } from "../../core";
import type { Project, ResultEnvelope } from "../../generated/types";
import * as validators from "../../generated/validators.js";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { AuthorizedCtx } from "./authz";
import { provisioningRecipient } from "./operator_provisioning";
import { decode, fail, validate } from "./validation";

/** Catalog membership is additional provenance on reader grants, not a new role. */
export async function currentCatalogGrant(ctx: QueryCtx, grant: Doc<"grants">) {
	if (grant.catalogEpoch === undefined) return true;
	if (grant.resourceKind !== "snapshot") return false;
	const snapshot = await ctx.db.query("snapshots").withIndex("by_snapshot", (q) => q.eq("snapshotId", grant.resourceId)).unique();
	return !!snapshot?.demoCatalog && snapshot.catalogEpoch === grant.catalogEpoch;
}

export async function claimCatalog(ctx: MutationCtx, principal: Principal) {
	const snapshots = await ctx.db.query("snapshots").withIndex("by_catalog", (q) => q.eq("demoCatalog", true)).take(9);
	if (!snapshots.length) return fail("capability_disabled", "Demo catalog is unavailable");
	if (snapshots.length > 8) return fail("limit_exceeded", "Demo catalog exceeds the eight-snapshot limit");
	for (const snapshot of snapshots) {
		const project = decode<Project>(validators.Project, snapshot.project);
		if (project.dataLabel !== "public" || snapshot.catalogEpoch === undefined) return fail("internal", "Invalid catalog configuration");
		const grants = await ctx.db.query("grants").withIndex("by_principal_resource", (q) => q.eq("principal", principal.id).eq("resourceKind", "snapshot").eq("resourceId", snapshot.snapshotId)).collect();
		// A tombstone or old catalog epoch is never repaired by self-service claims.
		if (grants.some((grant) => grant.revokedAt !== undefined || (grant.catalogEpoch !== undefined && grant.catalogEpoch !== snapshot.catalogEpoch))) return fail("not_found", "Resource not found");
		if (!grants.length) await ctx.db.insert("grants", {
			principal: principal.id, resourceKind: "snapshot", resourceId: snapshot.snapshotId,
			role: "reader", epoch: 1, catalogEpoch: snapshot.catalogEpoch,
		});
	}
	return ctx.db.insert("catalogClaims", {
		principal: principal.id,
		snapshots: snapshots.map((snapshot) => ({ snapshotId: snapshot.snapshotId, epoch: snapshot.catalogEpoch ?? 0 })),
	});
}

export async function readCatalogClaim(ctx: QueryCtx, authorized: AuthorizedCtx, claimId: string): Promise<ResultEnvelope> {
	const id = ctx.db.normalizeId("catalogClaims", claimId);
	const claim = id && await ctx.db.get(id);
	if (!claim || claim.principal !== authorized.principal.id) return fail("not_found", "Resource not found");
	const projects: Project[] = [];
	for (const item of claim.snapshots) {
		const snapshot = await authorized.loadAuthorized("snapshot", item.snapshotId);
		if (!snapshot.demoCatalog || snapshot.catalogEpoch !== item.epoch) return fail("not_found", "Resource not found");
		const project = decode<Project>(validators.Project, snapshot.project);
		if (project.dataLabel !== "public") return fail("not_found", "Resource not found");
		projects.push(project);
	}
	return validate<ResultEnvelope>(validators.ResultEnvelope, {
		kind: "projects", scope: { snapshotIds: claim.snapshots.map((item) => item.snapshotId) },
		entries: projects, coverage: { status: "not_indexed" }, nextCursor: null, truncated: { is: false },
	}, true);
}

/** Only the internal operator boundary can advertise already registered public data. */
export async function setCatalog(ctx: MutationCtx, args: { ownerTokenIdentifier: string; input: { snapshotId: string; enabled: boolean } }) {
	const owner = await provisioningRecipient(ctx, args);
	const input = args.input;
	if (!input || Object.keys(input).length !== 2 || typeof input.enabled !== "boolean" || !validators.ReadHistoryRequest({ snapshotId: input.snapshotId })) return fail("invalid_request", "Invalid catalog configuration");
	const grants = await ctx.db.query("grants").withIndex("by_principal_resource", (q) => q.eq("principal", owner.id).eq("resourceKind", "snapshot").eq("resourceId", input.snapshotId)).collect();
	if (!grants.some((grant) => grant.role === "owner" && grant.revokedAt === undefined && grant.catalogEpoch === undefined)) return fail("not_found", "Resource not found");
	const snapshot = await ctx.db.query("snapshots").withIndex("by_snapshot", (q) => q.eq("snapshotId", input.snapshotId)).unique();
	if (!snapshot) return fail("not_found", "Resource not found");
	const project = decode<Project>(validators.Project, snapshot.project);
	if (input.enabled && project.dataLabel !== "public") return fail("invalid_request", "Only public source snapshots may enter the demo catalog");
	if (!!snapshot.demoCatalog === input.enabled) return null;
	if (input.enabled && (await ctx.db.query("snapshots").withIndex("by_catalog", (q) => q.eq("demoCatalog", true)).take(8)).length >= 8) return fail("limit_exceeded", "Demo catalog exceeds the eight-snapshot limit");
	const epoch = (snapshot.catalogEpoch ?? 0) + 1;
	if (!Number.isSafeInteger(epoch)) return fail("limit_exceeded", "Catalog epoch exhausted");
	await ctx.db.patch(snapshot._id, { demoCatalog: input.enabled, catalogEpoch: epoch });
	return null;
}

/** Internal operator metadata lookup used to preserve immutable ingestion timestamps. */
export async function catalogIndexedAt(ctx: QueryCtx, args: { ownerTokenIdentifier: string; input: { snapshotId: string } }) {
	const owner = await provisioningRecipient(ctx, args);
	if (!args.input || Object.keys(args.input).length !== 1 || !validators.ReadHistoryRequest({ snapshotId: args.input.snapshotId })) return fail("invalid_request", "Invalid snapshot selection");
	const snapshot = await ctx.db.query("snapshots").withIndex("by_snapshot", (q) => q.eq("snapshotId", args.input.snapshotId)).unique();
	if (!snapshot) return null;
	const grants = await ctx.db.query("grants").withIndex("by_principal_resource", (q) => q.eq("principal", owner.id).eq("resourceKind", "snapshot").eq("resourceId", args.input.snapshotId)).collect();
	if (!grants.some((grant) => grant.role === "owner" && grant.revokedAt === undefined && grant.catalogEpoch === undefined)) return fail("not_found", "Resource not found");
	const summary = decode<Project>(validators.Project, snapshot.project).snapshots[0];
	if (!summary) return fail("internal", "Invalid snapshot configuration");
	return summary.indexedAt;
}
