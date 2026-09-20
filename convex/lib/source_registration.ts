import { canonicalArguments, type Principal } from "../../core";
import type {
	CommitRecord,
	Project,
	SnapshotEntry,
} from "../../generated/types";
import * as validators from "../../generated/validators.js";
import type { MutationCtx } from "../_generated/server";
import { requireAccess, requirePrincipal } from "./authz";
import { digest, gitBlobDigest } from "./source_cursors";
import { SourceAccess } from "./sources";
import { decode, fail, validate } from "./validation";

/** Called only by a trusted ingestion path. Public callers cannot upload a fake
 * tree. Identity still comes from verified auth, never an ingestion argument.
 */
export async function registerSnapshot(
	ctx: MutationCtx,
	input: { project: unknown; entries: unknown },
) {
	return registerSnapshotForPrincipal(ctx, await requirePrincipal(ctx), input);
}

export async function registerSnapshotForPrincipal(
	ctx: MutationCtx,
	principal: Principal,
	input: { project: unknown; entries: unknown },
) {
	const project = validate<Project>(validators.Project, input.project);
	if (project.snapshots.length !== 1 || project.provider !== "local-git") {
		return fail("invalid_request", "Register one local Git snapshot at a time");
	}
	if (!Array.isArray(input.entries) || input.entries.length > 5000) {
		return fail("limit_exceeded", "Snapshot entry limit exceeded");
	}
	const serialized = canonicalArguments(input);
	if (new TextEncoder().encode(serialized).length > 750000) {
		return fail("limit_exceeded", "Snapshot registration exceeds 750000 bytes");
	}
	const summary = project.snapshots[0];
	const objectLength = summary.hashAlgorithm === "sha1" ? 40 : 64;
	if (
		summary.commit.length !== objectLength ||
		summary.rootTreeId.length !== objectLength
	) {
		return fail("invalid_request", "Object ids do not match hash algorithm");
	}
	const entries = input.entries.map((entry) =>
		validate<SnapshotEntry>(validators.SnapshotEntry, entry),
	);
	const byId = new Map(entries.map((entry) => [entry.entryId, entry]));
	if (byId.size !== entries.length) {
		return fail("invalid_request", "Duplicate entry identities");
	}
	for (const entry of entries) {
		if (
			entry.snapshotId !== summary.snapshotId ||
			entry.objectId.length !== objectLength ||
			(entry.kind === "blob" && !Number.isSafeInteger(entry.size))
		) {
			return fail("invalid_request", "Entry does not match snapshot");
		}
		const seen = new Set([entry.entryId]);
		let parent = entry.parentEntryId;
		while (parent !== null) {
			const ancestor = byId.get(parent);
			if (!ancestor || ancestor.kind !== "tree" || seen.has(parent)) {
				return fail("invalid_request", "Invalid tree ancestry");
			}
			seen.add(parent);
			if (seen.size > 128) {
				return fail("limit_exceeded", "Tree nesting exceeds 128 levels");
			}
			parent = ancestor.parentEntryId;
		}
	}
	const registrationDigest = await digest(new TextEncoder().encode(serialized));
	const existing = await ctx.db
		.query("snapshots")
		.withIndex("by_snapshot", (q) => q.eq("snapshotId", summary.snapshotId))
		.unique();
	if (existing) {
		const grant = await requireAccess(
			ctx,
			principal,
			"snapshot",
			summary.snapshotId,
			"browseSnapshot",
		);
		if (grant.role !== "owner") {
			return fail("not_found", "Resource not found");
		}
		if (existing.registrationDigest !== registrationDigest) {
			return fail("invalid_request", "Snapshot registration is immutable");
		}
		return summary.snapshotId;
	}
	await ctx.db.insert("snapshots", {
		snapshotId: summary.snapshotId,
		repositoryId: project.repositoryId,
		project: JSON.stringify(project),
		registrationDigest,
		cursorSecret: crypto.randomUUID(),
	});
	for (const entry of entries) {
		await ctx.db.insert("entries", {
			snapshotId: summary.snapshotId,
			entryId: entry.entryId,
			parentEntryId: entry.parentEntryId,
			body: JSON.stringify(entry),
		});
	}
	await ctx.db.insert("grants", {
		principal: principal.id,
		resourceKind: "snapshot",
		resourceId: summary.snapshotId,
		role: "owner",
		epoch: 1,
	});
	if (
		!(await ctx.db
			.query("sourceSettings")
			.withIndex("by_key", (q) => q.eq("key", "cursor"))
			.unique())
	) {
		await ctx.db.insert("sourceSettings", {
			key: "cursor",
			cursorSecret: crypto.randomUUID(),
		});
	}
	return summary.snapshotId;
}

export async function cacheSource(
	ctx: MutationCtx,
	input: { snapshotId: string; entryId: string; bytes: ArrayBuffer },
) {
	return cacheSourceForPrincipal(ctx, await requirePrincipal(ctx), input);
}

export async function cacheSourceForPrincipal(
	ctx: MutationCtx,
	principal: Principal,
	input: { snapshotId: string; entryId: string; bytes: ArrayBuffer },
) {
	const sources = new SourceAccess(ctx, principal, async (snapshotId) => {
		const grant = await requireAccess(
			ctx,
			principal,
			"snapshot",
			snapshotId,
			"readSource",
		);
		if (grant.role !== "owner") {
			return fail("not_found", "Resource not found");
		}
	});
	const { snapshot, entry } = await sources.entry(
		input.snapshotId,
		input.entryId,
	);
	const bytes = new Uint8Array(input.bytes);
	if (bytes.length > 512 * 1024) {
		return fail("limit_exceeded", "Source cache window exceeds 512 KiB");
	}
	if (entry.kind !== "blob" || entry.size !== bytes.length) {
		return fail("invalid_request", "Cached bytes do not match the entry");
	}
	const project = decode<Project>(validators.Project, snapshot.project);
	const summary = project.snapshots[0];
	if (!summary) {
		return fail("internal", "Snapshot metadata is missing");
	}
	const blobId = await gitBlobDigest(bytes, summary.hashAlgorithm);
	if (blobId !== entry.objectId) {
		return fail("invalid_request", "Cached bytes fail Git object integrity");
	}
	const value = {
		snapshotId: input.snapshotId,
		repositoryId: snapshot.repositoryId,
		blobId,
		bytes: input.bytes,
		digest: await digest(bytes),
	};
	const existing = await ctx.db
		.query("sourceCache")
		.withIndex("by_snapshot_blob", (q) =>
			q.eq("snapshotId", input.snapshotId).eq("blobId", blobId),
		)
		.unique();
	if (existing) {
		await ctx.db.replace(existing._id, value);
	} else {
		await ctx.db.insert("sourceCache", value);
	}
	return null;
}

/** Trusted ingestion of at most 100 observed commits. `complete: false` means the
 * cached prefix ended at a bound; the last page remains explicitly partial. */
export async function cacheHistory(
	ctx: MutationCtx,
	input: {
		snapshotId: string;
		entryId?: string;
		records: unknown;
		complete: boolean;
	},
) {
	return cacheHistoryForPrincipal(ctx, await requirePrincipal(ctx), input);
}

export async function cacheHistoryForPrincipal(
	ctx: MutationCtx,
	principal: Principal,
	input: {
		snapshotId: string;
		entryId?: string;
		records: unknown;
		complete: boolean;
	},
) {
	const sources = new SourceAccess(ctx, principal, async (snapshotId) => {
		const grant = await requireAccess(
			ctx,
			principal,
			"snapshot",
			snapshotId,
			"readHistory",
		);
		if (grant.role !== "owner") {
			return fail("not_found", "Resource not found");
		}
	});
	const snapshot = await sources.snapshot(input.snapshotId);
	if (input.entryId) {
		await sources.entry(input.snapshotId, input.entryId);
	}
	if (
		!Array.isArray(input.records) ||
		input.records.length > 100 ||
		typeof input.complete !== "boolean"
	) {
		return fail("invalid_request", "Invalid bounded history cache");
	}
	const records = input.records.map((record) =>
		validate<CommitRecord>(validators.CommitRecord, record),
	);
	const summary = decode<Project>(validators.Project, snapshot.project)
		.snapshots[0];
	if (!summary) {
		return fail("internal", "Snapshot metadata is missing");
	}
	const seen = new Set<string>();
	for (const record of records) {
		const length = summary.hashAlgorithm === "sha1" ? 40 : 64;
		if (
			record.hashAlgorithm !== summary.hashAlgorithm ||
			record.commit.length !== length ||
			record.parents.some((parent) => parent.length !== length) ||
			record.comparedTo !== (record.parents[0] ?? null) ||
			seen.has(record.commit)
		) {
			return fail("invalid_request", "History does not match snapshot");
		}
		seen.add(record.commit);
	}
	if (!input.entryId) {
		if (
			!records.length ||
			records[0].commit !== summary.commit ||
			records
				.slice(1)
				.some((record, i) => record.commit !== records[i].comparedTo) ||
			(input.complete && records.at(-1)?.comparedTo !== null)
		) {
			return fail(
				"invalid_request",
				"History is not a pinned first-parent chain",
			);
		}
	}
	const body = JSON.stringify(records);
	if (new TextEncoder().encode(body).length > 750000) {
		return fail("limit_exceeded", "History cache exceeds 750000 bytes");
	}
	const value = {
		snapshotId: input.snapshotId,
		entryId: input.entryId ?? null,
		body,
		complete: input.complete,
		digest: await digest(new TextEncoder().encode(body)),
	};
	const existing = await ctx.db
		.query("historyCache")
		.withIndex("by_snapshot_entry", (q) =>
			q.eq("snapshotId", input.snapshotId).eq("entryId", input.entryId ?? null),
		)
		.unique();
	if (existing) {
		await ctx.db.replace(existing._id, value);
	} else {
		await ctx.db.insert("historyCache", value);
	}
	return null;
}
