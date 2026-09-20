import type { Principal } from "../../core";
import { SourceReadError, sourceWindow } from "../../core/source-ref";
import type {
	BrowseSnapshotRequest,
	CommitRecord,
	Evidence,
	ListProjectsRequest,
	Project,
	ReadHistoryRequest,
	ReadSourceRequest,
	ResultEnvelope,
	SnapshotEntry,
} from "../../generated/types";
import * as validators from "../../generated/validators.js";
import type { QueryCtx } from "../_generated/server";
import { currentCatalogGrant } from "./catalog";
import { digest, gitBlobDigest, sourceCursor } from "./source_cursors";
import { decode, fail, validate } from "./validation";

const byteLength = (value: unknown) =>
	new TextEncoder().encode(JSON.stringify(value)).length;

/** Snapshot access uses the same grant check and fencing as investigations.
 * Raw database handles never escape this capability.
 */
export class SourceAccess {
	constructor(
		private readonly ctx: QueryCtx,
		private readonly principal: Principal,
		private readonly authorize: (snapshotId: string) => Promise<void>,
	) {}

	private async optionalSnapshot(snapshotId: string) {
		await this.authorize(snapshotId);
		const row = await this.ctx.db
			.query("snapshots")
			.withIndex("by_snapshot", (q) => q.eq("snapshotId", snapshotId))
			.unique();
		return row;
	}

	async snapshot(snapshotId: string) {
		const row = await this.optionalSnapshot(snapshotId);
		if (!row) return fail("not_found", "Resource not found");
		return row;
	}

	async entry(snapshotId: string, entryId: string) {
		const snapshot = await this.snapshot(snapshotId);
		const row = await this.ctx.db
			.query("entries")
			.withIndex("by_snapshot_entry", (q) =>
				q.eq("snapshotId", snapshotId).eq("entryId", entryId),
			)
			.unique();
		if (!row) {
			return fail("source_unavailable", "Source entry is unavailable");
		}
		return {
			snapshot,
			entry: decode<SnapshotEntry>(validators.SnapshotEntry, row.body),
		};
	}

	async browse(request: BrowseSnapshotRequest): Promise<ResultEnvelope> {
		const snapshot = await this.snapshot(request.snapshotId);
		const parent = request.parentEntryId ?? null;
		if (
			parent !== null &&
			(await this.entry(request.snapshotId, parent)).entry.kind !== "tree"
		) {
			return fail("invalid_request", "Select a tree entry");
		}
		const cursor = await sourceCursor(snapshot.cursorSecret, [
			"tree",
			this.principal.id,
			request.snapshotId,
			parent,
		]);
		const after = await cursor.decode(request.cursor);
		const rows = await this.ctx.db
			.query("entries")
			.withIndex("by_snapshot_parent_entry", (q) =>
				q
					.eq("snapshotId", request.snapshotId)
					.eq("parentEntryId", parent)
					.gt("entryId", after),
			)
			.take(101);
		const project = decode<Project>(validators.Project, snapshot.project);
		const summary = project.snapshots[0];
		if (!summary) {
			return fail("internal", "Snapshot metadata is missing");
		}
		const result: ResultEnvelope = {
			kind: "tree",
			scope: { snapshotIds: [request.snapshotId] },
			entries: [],
			coverage: { status: summary.coverage },
			nextCursor: null,
			freshness: { indexedAt: summary.indexedAt, stale: false },
			truncated: { is: false },
		};
		let last = after;
		for (const row of rows) {
			const entry = decode<SnapshotEntry>(validators.SnapshotEntry, row.body);
			if (
				result.entries.length === 100 ||
				byteLength({ ...result, entries: [...result.entries, entry] }) > 15000
			) {
				if (last === after) {
					return fail("limit_exceeded", "Tree entry exceeds response cap");
				}
				result.nextCursor = await cursor.encode(last);
				result.truncated = {
					is: true,
					reason: result.entries.length === 100 ? "page_limit" : "response_cap",
				};
				break;
			}
			result.entries.push(entry);
			last = row.entryId;
		}
		return result;
	}

	async projects(request: ListProjectsRequest): Promise<ResultEnvelope> {
		if (request.workspaceId) {
			return fail("not_found", "Resource not found");
		}
		const result: ResultEnvelope = {
			kind: "projects",
			scope: { snapshotIds: [] },
			entries: [],
			coverage: { status: "complete" },
			nextCursor: null,
			truncated: { is: false },
		};
		const settings = await this.ctx.db
			.query("sourceSettings")
			.withIndex("by_key", (q) => q.eq("key", "cursor"))
			.unique();
		if (!settings) {
			if (request.cursor) {
				return fail("cursor_invalid", "Invalid cursor");
			}
			return result;
		}
		const cursor = await sourceCursor(settings.cursorSecret, [
			"projects",
			this.principal.id,
		]);
		const after = await cursor.decode(request.cursor);
		const grants = await this.ctx.db
			.query("grants")
			.withIndex("by_principal_resource", (q) =>
				q
					.eq("principal", this.principal.id)
					.eq("resourceKind", "snapshot")
					.gt("resourceId", after),
			)
			.take(9);
		const projects = new Map<string, Project>();
		const snapshotIds: string[] = [];
		let last = after;
		for (const grant of grants) {
			if (snapshotIds.length === 8) {
				result.nextCursor = await cursor.encode(last);
				result.truncated = { is: true, reason: "page_limit" };
				break;
			}
			if (grant.revokedAt !== undefined || !(await currentCatalogGrant(this.ctx, grant))) {
				last = grant.resourceId;
				continue;
			}
			const snapshot = await this.optionalSnapshot(grant.resourceId);
			// Early demo grants can predate snapshot registration. List existing
			// resources only; dangling IDs stay out of entries and scope. The
			// existing signed cursor still contains the caller's scan position.
			if (!snapshot) {
				last = grant.resourceId;
				continue;
			}
			const project = decode<Project>(validators.Project, snapshot.project);
			const existing = projects.get(project.repositoryId);
			const combined = validate<Project>(
				validators.Project,
				existing
					? {
							...existing,
							snapshots: [...existing.snapshots, ...project.snapshots],
						}
					: project,
				true,
			);
			const candidates = [...projects.values()]
				.filter((item) => item.repositoryId !== project.repositoryId)
				.concat(combined);
			if (byteLength({ ...result, entries: candidates }) > 14000) {
				if (last === after) {
					return fail("limit_exceeded", "Project exceeds response cap");
				}
				result.nextCursor = await cursor.encode(last);
				result.truncated = { is: true, reason: "response_cap" };
				break;
			}
			projects.set(project.repositoryId, combined);
			snapshotIds.push(grant.resourceId);
			last = grant.resourceId;
		}
		// A scan page can include revoked grants. Continue from the last scanned key.
		if (!result.nextCursor && grants.length === 9) {
			result.nextCursor = await cursor.encode(last);
			result.truncated = { is: true, reason: "page_limit" };
		}
		result.entries = [...projects.values()];
		result.scope = validate<ResultEnvelope>(
			validators.ResultEnvelope,
			{ ...result, scope: { snapshotIds } },
			true,
		).scope;
		return result;
	}

	async history(request: ReadHistoryRequest): Promise<ResultEnvelope> {
		const snapshot = await this.snapshot(request.snapshotId);
		if (request.entryId) {
			await this.entry(request.snapshotId, request.entryId);
		}
		const cached = await this.ctx.db
			.query("historyCache")
			.withIndex("by_snapshot_entry", (q) =>
				q
					.eq("snapshotId", request.snapshotId)
					.eq("entryId", request.entryId ?? null),
			)
			.unique();
		if (!cached) {
			return fail("source_unavailable", "History is unavailable");
		}
		if (
			(await digest(new TextEncoder().encode(cached.body))) !== cached.digest
		) {
			return fail("source_unavailable", "History integrity check failed");
		}
		const records: CommitRecord[] = JSON.parse(cached.body).map(
			(record: unknown) =>
				validate<CommitRecord>(validators.CommitRecord, record, true),
		);
		const limit = request.maxCommits ?? 20;
		const cursor = await sourceCursor(snapshot.cursorSecret, [
			"history",
			this.principal.id,
			request.snapshotId,
			request.entryId ?? null,
			limit,
			cached.digest,
		]);
		const position = await cursor.decode(request.cursor);
		const offset = position === "" ? 0 : Number(position);
		if (
			!Number.isSafeInteger(offset) ||
			offset < 0 ||
			(position !== "" && offset >= records.length)
		) {
			return fail("cursor_invalid", "Invalid history cursor");
		}
		const result: ResultEnvelope = {
			kind: "history",
			scope: { snapshotIds: [request.snapshotId] },
			entries: [],
			coverage: { status: "complete" },
			nextCursor: null,
			truncated: { is: false },
		};
		for (const record of records.slice(offset, offset + limit)) {
			if (
				byteLength({ ...result, entries: [...result.entries, record] }) > 15000
			) {
				if (!result.entries.length) {
					return fail("limit_exceeded", "Commit exceeds response cap");
				}
				break;
			}
			result.entries.push(record);
		}
		const end = offset + result.entries.length;
		if (end < records.length || !cached.complete) {
			result.coverage.status = "partial";
			result.truncated = {
				is: true,
				reason:
					result.entries.length < limit && end < records.length
						? "response_cap"
						: "page_limit",
			};
			result.nextCursor =
				end < records.length ? await cursor.encode(String(end)) : null;
		}
		return result;
	}

	async read(request: ReadSourceRequest): Promise<Evidence> {
		const { snapshot, entry } = await this.entry(
			request.snapshotId,
			request.entryId,
		);
		if (entry.kind !== "blob") {
			return fail("unsupported", "Only regular Git blobs can be read");
		}
		const cache = await this.ctx.db
			.query("sourceCache")
			.withIndex("by_snapshot_blob", (q) =>
				q.eq("snapshotId", request.snapshotId).eq("blobId", entry.objectId),
			)
			.unique();
		if (!cache) {
			return fail("source_unavailable", "Source bytes are unavailable");
		}
		const bytes = new Uint8Array(cache.bytes);
		if (
			cache.repositoryId !== snapshot.repositoryId ||
			bytes.length !== entry.size ||
			(await digest(bytes)) !== cache.digest
		) {
			return fail("source_unavailable", "Source integrity check failed");
		}
		const project = decode<Project>(validators.Project, snapshot.project);
		const summary = project.snapshots[0];
		if (!summary) {
			return fail("internal", "Snapshot metadata is missing");
		}
		try {
			if (
				(await gitBlobDigest(bytes, summary.hashAlgorithm)) !== entry.objectId
			) {
				return fail("source_unavailable", "Source integrity check failed");
			}
			const window = sourceWindow(bytes, request);
			return {
				ref: {
					repositoryId: snapshot.repositoryId,
					snapshotId: request.snapshotId,
					entryId: entry.entryId,
					commit: summary.commit,
					hashAlgorithm: summary.hashAlgorithm,
					blobId: entry.objectId,
					...(entry.displayPath !== undefined
						? { displayPath: entry.displayPath }
						: {}),
					byteRange: { start: window.start, end: window.end },
					digest: await digest(bytes.slice(window.start, window.end)),
				},
				encoding: "utf8",
				content: window.content,
				blobSize: bytes.length,
				evidenceClass: "observed_literal",
				rangeAdjusted: window.rangeAdjusted,
				...(window.nextRange ? { nextRange: window.nextRange } : {}),
			};
		} catch (error) {
			if (error instanceof SourceReadError) {
				return fail(error.code, error.message);
			}
			throw error;
		}
	}
}
