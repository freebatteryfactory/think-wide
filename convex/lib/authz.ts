import {
	compareRevision,
	may,
	type Principal,
	principalFromIdentity,
	type ResourceKind,
} from "../../core";
import type { OperationId } from "../../generated/operations";
import { SourceReadError, validateIndexedRef } from "../../core/source-ref";
import type {
	Decision,
	Investigation,
	ReadInvestigationRequest,
	Run,
	SourceRef,
	Project,
	Proposal,
	PrepareHandoffRequest,
} from "../../generated/types";
import * as validators from "../../generated/validators.js";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { claimCatalog, currentCatalogGrant, readCatalogClaim } from "./catalog";
import { decode, fail } from "./validation";
import { SourceAccess } from "./sources";
import { publishAuthorizedRun } from "./publication";
import { createHandoff, HandoffAccess } from "./handoffs";

export async function requirePrincipal(
	ctx: Pick<QueryCtx, "auth">,
): Promise<Principal> {
	const principal = principalFromIdentity(await ctx.auth.getUserIdentity());
	return principal ?? fail("unauthenticated", "Authentication required");
}

export async function requireAccess(
	ctx: QueryCtx,
	principal: Principal,
	resourceKind: ResourceKind,
	resourceId: string,
	action: OperationId,
): Promise<Doc<"grants">> {
	const grants = await ctx.db
		.query("grants")
		.withIndex("by_principal_resource", (q) =>
			q
				.eq("principal", principal.id)
				.eq("resourceKind", resourceKind)
				.eq("resourceId", resourceId),
		)
		.collect();
	for (const grant of grants) {
		if (
			may(principal, action, { kind: resourceKind, id: resourceId }, [
				grant,
			]) === "allow" &&
			(await currentCatalogGrant(ctx, grant))
		)
			return grant;
	}
	return fail("not_found", "Resource not found");
}

type ProtectedDocs = {
	snapshot: Doc<"snapshots">;
	investigation: Doc<"investigations">;
	decision: Doc<"decisions">;
	run: Doc<"runs">;
};
type Fence = Doc<"runs">["fences"][number];

/** This capability exposes no raw database, auth, scheduler, or service credentials. */
export class AuthorizedCtx {
	readonly sources: SourceAccess;
	readonly handoffs: HandoffAccess;
	readonly principal: Principal;
	readonly operationId: OperationId;
	#ctx: QueryCtx;
	#fences = new Map<string, Fence>();

	constructor(ctx: QueryCtx, principal: Principal, operationId: OperationId) {
		this.#ctx = ctx;
		this.principal = principal;
		this.operationId = operationId;
		this.handoffs = new HandoffAccess(ctx, this);
		this.sources = new SourceAccess(ctx, principal, (snapshotId) =>
			this.requireAccess("snapshot", snapshotId),
		);
	}

	async readCatalogClaim(id: string) {
		return readCatalogClaim(this.#ctx, this, id);
	}

	async requireAccess(kind: ResourceKind, id: string): Promise<void> {
		const grant = await requireAccess(
			this.#ctx,
			this.principal,
			kind,
			id,
			this.operationId,
		);
		this.#fences.set(grant._id, { grantId: grant._id, epoch: grant.epoch });
	}

	fences(): Fence[] {
		return [...this.#fences.values()].sort((a, b) =>
			a.grantId.localeCompare(b.grantId),
		);
	}

	async loadAuthorized<K extends keyof ProtectedDocs>(
		kind: K,
		id: string,
	): Promise<ProtectedDocs[K]>;
	async loadAuthorized(
		kind: keyof ProtectedDocs,
		id: string,
	): Promise<ProtectedDocs[keyof ProtectedDocs]> {
		if (kind === "snapshot") return this.sources.snapshot(id);
		// Authorize the parent before reading its body. Children inherit this scope.
		if (kind === "investigation") {
			await this.requireAccess(kind, id);
			const normalized = this.#ctx.db.normalizeId("investigations", id);
			const row = normalized && (await this.#ctx.db.get(normalized));
			if (!row) return fail("not_found", "Resource not found");
			const value = decode<Investigation>(validators.Investigation, row.body);
			for (const snapshotId of value.snapshotIds)
				await this.requireAccess("snapshot", snapshotId);
			return row;
		}
		if (kind === "decision") {
			const normalized = this.#ctx.db.normalizeId("decisions", id);
			const row = normalized && (await this.#ctx.db.get(normalized));
			if (!row) return fail("not_found", "Resource not found");
			const parent = await this.loadAuthorized(
				"investigation",
				row.investigationId,
			);
			const value = decode<Decision>(validators.Decision, row.body);
			await this.authorizeDecision(
				value,
				decode<Investigation>(validators.Investigation, parent.body),
			);
			return row;
		}
		const normalized = this.#ctx.db.normalizeId("runs", id);
		const row = normalized && (await this.#ctx.db.get(normalized));
		if (!row) return fail("not_found", "Resource not found");
		await this.loadAuthorized("investigation", row.investigationId);
		return row;
	}

	async authorizeRefs(
		refs: readonly SourceRef[],
		investigation: Investigation,
	): Promise<void> {
		for (const ref of refs) {
			if (!ref.snapshotId)
				fail(
					"source_unavailable",
					"Snapshot binding required for source reference",
				);
			await this.requireAccess("snapshot", ref.snapshotId);
			if (!investigation.snapshotIds.includes(ref.snapshotId))
				fail("not_found", "Resource not found");
			if (
				ref.byteRange.end < ref.byteRange.start ||
				(ref.lineRange && ref.lineRange.end < ref.lineRange.start) ||
				ref.commit.length !== (ref.hashAlgorithm === "sha1" ? 40 : 64) ||
				ref.blobId.length !== (ref.hashAlgorithm === "sha1" ? 40 : 64)
			)
				fail("invalid_request", "Invalid source range or hash algorithm", {
					details: [
						{
							path: "/refs",
							problem: "Invalid source range or hash algorithm",
						},
					],
				});
			const { snapshot, entry } = await this.sources.entry(
				ref.snapshotId,
				ref.entryId,
			);
			try {
				validateIndexedRef(
					ref,
					decode<Project>(validators.Project, snapshot.project),
					entry,
				);
			} catch (error) {
				if (error instanceof SourceReadError) fail(error.code, error.message);
				throw error;
			}
		}
	}

	/** Called by the operation pipeline before receipts, including replays. It checks
	 * authority, not mutable run status, so an authorized retry remains replayable. */
	async authorizeProposal(proposal: Proposal): Promise<Doc<"runs">> {
		const investigation = await this.investigation(proposal.investigationId);
		if (!proposal.runId)
			fail("invalid_request", "Host admission is required before submission", {
				details: [
					{
						path: "/proposal/runId",
						problem: "Call beginHostRun before reasoning",
					},
				],
			});
		const row = await this.loadAuthorized("run", proposal.runId);
		if (
			row.principal !== this.principal.id ||
			row.investigationId !== proposal.investigationId
		)
			fail("not_found", "Resource not found");
		for (const claim of proposal.claims)
			await this.authorizeRefs(claim.refs, investigation);
		return row;
	}

	async authorizeDecision(
		decision: Pick<Decision, "refs" | "targetFindingId">,
		investigation: Investigation,
	): Promise<void> {
		if (decision.targetFindingId) {
			const finding = investigation.acceptedFindings?.find(
				(candidate) => candidate.findingId === decision.targetFindingId,
			);
			if (!finding) fail("not_found", "Resource not found");
			await this.authorizeRefs(finding.refs, investigation);
		}
		await this.authorizeRefs(decision.refs ?? [], investigation);
	}

	async investigation(id: string): Promise<Investigation> {
		return decode<Investigation>(
			validators.Investigation,
			(await this.loadAuthorized("investigation", id)).body,
		);
	}

	async decision(id: string): Promise<Decision> {
		return decode<Decision>(
			validators.Decision,
			(await this.loadAuthorized("decision", id)).body,
		);
	}

	async run(id: string): Promise<Run> {
		return decode<Run>(
			validators.Run,
			(await this.loadAuthorized("run", id)).body,
		);
	}

	/** Scope is authorized before the indexed page is read; every returned child is checked. */
	async queryAuthorized(
		investigationId: string,
		after: number,
		maximum: number,
	): Promise<Decision[]> {
		const parent = await this.loadAuthorized("investigation", investigationId);
		return this.#queryDecisions(parent, after, maximum);
	}

	async #queryDecisions(
		parent: Doc<"investigations">,
		after: number,
		maximum: number,
	): Promise<Decision[]> {
		const investigation = decode<Investigation>(
			validators.Investigation,
			parent.body,
		);
		const rows = await this.#ctx.db
			.query("decisions")
			.withIndex("by_investigation_revision", (q) =>
				q.eq("investigationId", parent._id).gt("resultingRevision", after),
			)
			.take(maximum);
		const result: Decision[] = [];
		for (const row of rows) {
			const decision = decode<Decision>(validators.Decision, row.body);
			await this.authorizeDecision(decision, investigation);
			result.push(decision);
		}
		return result;
	}

	async readInvestigation(
		request: ReadInvestigationRequest,
	): Promise<Investigation> {
		const row = await this.loadAuthorized(
			"investigation",
			request.investigationId,
		);
		const investigation = decode<Investigation>(
			validators.Investigation,
			row.body,
		);
		if (request.detail === "summary") {
			// Summary is a complete metadata projection, with no body pagination.
			if (request.cursor) fail("cursor_invalid", "Invalid cursor");
			const summary = { ...investigation };
			delete summary.decisions;
			delete summary.acceptedFindings;
			summary.page = { nextCursor: null, truncated: { is: false } };
			return summary;
		}
		for (const finding of investigation.acceptedFindings ?? []) {
			await this.authorizeRefs(finding.refs, investigation);
		}
		if (investigation.currentRunId)
			await this.loadAuthorized("run", investigation.currentRunId);
		const key = await crypto.subtle.importKey(
			"raw",
			new TextEncoder().encode(row.cursorSecret),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign", "verify"],
		);
		const scope = JSON.stringify([
			this.principal.id,
			investigation.investigationId,
			investigation.revision,
			request.detail ?? "full",
			this.fences(),
		]);
		let after = 0;
		if (request.cursor) {
			const parts = request.cursor.split(".");
			if (
				parts.length !== 2 ||
				!/^(0|[1-9][0-9]*)$/.test(parts[0]) ||
				!/^[0-9a-f]{64}$/.test(parts[1])
			)
				fail("cursor_invalid", "Invalid cursor");
			after = Number(parts[0]);
			const signature = Uint8Array.from(parts[1].match(/../g) ?? [], (byte) =>
				Number.parseInt(byte, 16),
			);
			if (
				!Number.isSafeInteger(after) ||
				after > investigation.revision ||
				!(await crypto.subtle.verify(
					"HMAC",
					key,
					signature,
					new TextEncoder().encode(`${scope}:${after}`),
				))
			)
				fail("cursor_invalid", "Invalid cursor");
		}
		const decisions = await this.#queryDecisions(row, after, 65);
		const result: Investigation = { ...investigation, decisions: [] };
		let more = false;
		for (const decision of decisions) {
			if (
				result.decisions &&
				(result.decisions.length === 64 ||
					new TextEncoder().encode(
						JSON.stringify({
							...result,
							decisions: [...result.decisions, decision],
						}),
					).length > 15000)
			) {
				more = true;
				break;
			}
			result.decisions?.push(decision);
		}
		if (more && !result.decisions?.length)
			fail("limit_exceeded", "A decision exceeds the response limit");
		const last =
			result.decisions?.[result.decisions.length - 1]?.resultingRevision ??
			after;
		let nextCursor: string | null = null;
		if (more) {
			const signature = await crypto.subtle.sign(
				"HMAC",
				key,
				new TextEncoder().encode(`${scope}:${last}`),
			);
			nextCursor = `${last}.${Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
		}
		result.page = {
			nextCursor,
			truncated: more ? { is: true, reason: "response_cap" } : { is: false },
		};
		return result;
	}
}

export class AuthorizedMutationCtx extends AuthorizedCtx {
	#ctx: MutationCtx;
	constructor(
		ctx: MutationCtx,
		principal: Principal,
		operationId: OperationId,
	) {
		super(ctx, principal, operationId);
		this.#ctx = ctx;
	}

	async #grant(kind: ResourceKind, id: string): Promise<void> {
		await this.#ctx.db.insert("grants", {
			principal: this.principal.id,
			resourceKind: kind,
			resourceId: id,
			role: "owner",
			epoch: 1,
		});
	}

	async claimDemoAccess() {
		return claimCatalog(this.#ctx, this.principal);
	}

	async createHandoff(request: PrepareHandoffRequest): Promise<string> {
		return createHandoff(this.#ctx, this, request);
	}

	async createInvestigation(
		value: Omit<Investigation, "investigationId">,
	): Promise<string> {
		for (const snapshotId of value.snapshotIds)
			await this.requireAccess("snapshot", snapshotId);
		const id = await this.#ctx.db.insert("investigations", {
			body: "",
			cursorSecret: crypto.randomUUID(),
		});
		const body: Investigation = { ...value, investigationId: id };
		await this.#ctx.db.patch(id, { body: JSON.stringify(body) });
		await this.#grant("investigation", id);
		return id;
	}

	async appendDecision(value: Omit<Decision, "decisionId">): Promise<string> {
		const parent = await this.loadAuthorized(
			"investigation",
			value.investigationId,
		);
		const investigation = decode<Investigation>(
			validators.Investigation,
			parent.body,
		);
		await this.authorizeDecision(value, investigation);
		if (compareRevision(value.madeAtRevision, investigation.revision) !== "ok")
			fail("revision_conflict", "Investigation revision changed", {
				currentRevision: investigation.revision,
			});
		const id = await this.#ctx.db.insert("decisions", {
			investigationId: parent._id,
			resultingRevision: value.resultingRevision,
			body: "",
		});
		// Do not admit a decision which could never fit on an investigation page.
		if (
			new TextEncoder().encode(
				JSON.stringify({
					...investigation,
					revision: value.resultingRevision,
					decisions: [{ ...value, decisionId: id }],
				}),
			).length > 15000
		)
			fail("limit_exceeded", "Decision cannot fit on an investigation page");
		await this.#ctx.db.patch(id, {
			body: JSON.stringify({ ...value, decisionId: id }),
		});
		if (investigation.currentRunId) {
			const row = await this.loadAuthorized("run", investigation.currentRunId);
			const run = decode<Run>(validators.Run, row.body);
			if (run.status === "admitted" || run.status === "running")
				await this.#ctx.db.patch(row._id, {
					body: JSON.stringify({
						...run,
						status: "superseded",
						finishedAt: Date.now(),
					}),
				});
		}
		await this.#ctx.db.patch(parent._id, {
			body: JSON.stringify({
				...investigation,
				revision: value.resultingRevision,
				currentRunId: null,
			}),
		});
		return id;
	}

	async createRun(value: Omit<Run, "runId">): Promise<string> {
		const parent = await this.loadAuthorized(
			"investigation",
			value.investigationId,
		);
		const investigation = decode<Investigation>(
			validators.Investigation,
			parent.body,
		);
		if (compareRevision(value.baseRevision, investigation.revision) !== "ok")
			fail("revision_conflict", "Investigation revision changed", {
				currentRevision: investigation.revision,
			});
		// The parent and its snapshots are the entire admission authority.
		// Its pointer serializes admissions without scanning historical runs.
		if (investigation.currentRunId) {
			const run = await new AuthorizedCtx(
				this.#ctx,
				this.principal,
				this.operationId,
			).run(investigation.currentRunId);
			if (run.status === "admitted" || run.status === "running")
				fail(
					"limit_exceeded",
					"An active run already exists for this revision",
				);
		}
		const id = await this.#ctx.db.insert("runs", {
			investigationId: parent._id,
			baseRevision: value.baseRevision,
			principal: this.principal.id,
			fences: this.fences(),
			body: "",
		});
		await this.#ctx.db.patch(id, {
			body: JSON.stringify({ ...value, runId: id }),
			fences: this.fences(),
		});
		await this.#ctx.db.patch(parent._id, {
			body: JSON.stringify({ ...investigation, currentRunId: id }),
		});
		return id;
	}

	async submitProposal(proposal: Proposal): Promise<string> {
		const row = await this.authorizeProposal(proposal);
		const run = decode<Run>(validators.Run, row.body);
		if (run.driver !== "host")
			fail("unsupported", "Public submission requires a host run");
		const investigation = await this.investigation(proposal.investigationId);
		if (proposal.baseRevision !== investigation.revision)
			fail("revision_conflict", "Investigation revision changed", {
				currentRevision: investigation.revision,
			});
		const outcome = await publishAuthorizedRun(this.#ctx, this, proposal, row);
		// A public contract error rolls back this transaction, including any superseded
		// patch. Internal publication instead returns its outcome and persists that status.
		if (!outcome.published) fail("unsupported", "Run is no longer publishable");
		return investigation.investigationId;
	}

	async cancelRun(id: string): Promise<void> {
		const row = await this.loadAuthorized("run", id);
		const run = decode<Run>(validators.Run, row.body);
		if (run.status === "admitted" || run.status === "running")
			await this.#ctx.db.patch(row._id, {
				body: JSON.stringify({
					...run,
					status: "cancelled",
					finishedAt: Date.now(),
				}),
			});
	}
}
