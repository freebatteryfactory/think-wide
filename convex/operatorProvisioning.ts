import { internalMutation } from "./_generated/server";
import { provisioningRecipient } from "./lib/operator_provisioning";
import {
	cacheHistoryForPrincipal,
	cacheSourceForPrincipal,
	registerSnapshotForPrincipal,
} from "./lib/source_registration";

// Internal CLI-only operator provisioning. Never register these in OPERATIONS.
// Explicit recipients are permitted only by decision 0002's narrow exception.
export const registerSnapshot = internalMutation({
	handler: async (
		ctx,
		args: {
			ownerTokenIdentifier: string;
			input: Parameters<typeof registerSnapshotForPrincipal>[2];
		},
	) =>
		registerSnapshotForPrincipal(
			ctx,
			await provisioningRecipient(ctx, args),
			args.input,
		),
});

export const cacheSource = internalMutation({
	handler: async (
		ctx,
		args: {
			ownerTokenIdentifier: string;
			input: Parameters<typeof cacheSourceForPrincipal>[2];
		},
	) =>
		cacheSourceForPrincipal(
			ctx,
			await provisioningRecipient(ctx, args),
			args.input,
		),
});

export const cacheHistory = internalMutation({
	handler: async (
		ctx,
		args: {
			ownerTokenIdentifier: string;
			input: Parameters<typeof cacheHistoryForPrincipal>[2];
		},
	) =>
		cacheHistoryForPrincipal(
			ctx,
			await provisioningRecipient(ctx, args),
			args.input,
		),
});
