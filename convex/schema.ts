import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Public documents are JSON validated by generated validators on every read/write.
// Storage metadata is separate, avoiding a second handwritten public schema.
export default defineSchema({
	snapshots: defineTable({
		snapshotId: v.string(),
		repositoryId: v.string(),
		project: v.string(),
		registrationDigest: v.string(),
		cursorSecret: v.string(),
		demoCatalog: v.optional(v.boolean()),
		catalogEpoch: v.optional(v.number()),
	}).index("by_snapshot", ["snapshotId"]).index("by_catalog", ["demoCatalog", "snapshotId"]),
	entries: defineTable({
		snapshotId: v.string(),
		entryId: v.string(),
		parentEntryId: v.union(v.string(), v.null()),
		body: v.string(),
	})
		.index("by_snapshot_entry", ["snapshotId", "entryId"])
		.index("by_snapshot_parent_entry", [
			"snapshotId",
			"parentEntryId",
			"entryId",
		]),
	sourceCache: defineTable({
		snapshotId: v.string(),
		repositoryId: v.string(),
		blobId: v.string(),
		bytes: v.bytes(),
		digest: v.string(),
	}).index("by_snapshot_blob", ["snapshotId", "blobId"]),
	historyCache: defineTable({
		snapshotId: v.string(),
		entryId: v.union(v.string(), v.null()),
		body: v.string(),
		digest: v.string(),
		complete: v.boolean(),
	}).index("by_snapshot_entry", ["snapshotId", "entryId"]),
	sourceSettings: defineTable({
		key: v.string(),
		cursorSecret: v.string(),
	}).index("by_key", ["key"]),
	grants: defineTable({
		principal: v.string(),
		resourceKind: v.union(v.literal("investigation"), v.literal("snapshot")),
		resourceId: v.string(),
		role: v.union(v.literal("owner"), v.literal("reader")),
		epoch: v.number(),
		revokedAt: v.optional(v.number()),
		catalogEpoch: v.optional(v.number()),
	}).index("by_principal_resource", [
		"principal",
		"resourceKind",
		"resourceId",
	]),
	catalogClaims: defineTable({
		principal: v.string(),
		snapshots: v.array(v.object({ snapshotId: v.string(), epoch: v.number() })),
	}),
	investigations: defineTable({ body: v.string(), cursorSecret: v.string() }),
	decisions: defineTable({
		investigationId: v.id("investigations"),
		resultingRevision: v.number(),
		body: v.string(),
	}).index("by_investigation_revision", [
		"investigationId",
		"resultingRevision",
	]),
	handoffs: defineTable({
		investigationId: v.id("investigations"),
		snapshotIds: v.array(v.string()),
		body: v.string(),
	}),
	receipts: defineTable({
		principal: v.string(),
		operationId: v.string(),
		requestKey: v.string(),
		digest: v.string(),
		resultKind: v.union(
			v.literal("investigation"),
			v.literal("decision"),
			v.literal("run"),
			v.literal("handoff"),
			v.literal("catalog"),
		),
		resultId: v.string(),
	}).index("by_principal_operation_key", [
		"principal",
		"operationId",
		"requestKey",
	]),
	runs: defineTable({
		investigationId: v.id("investigations"),
		baseRevision: v.number(),
		principal: v.string(),
		body: v.string(),
		fences: v.array(v.object({ grantId: v.id("grants"), epoch: v.number() })),
	}),
});
