import { internalMutation } from "./_generated/server";
import { operation } from "./lib/operation";
import { publishRun } from "./lib/publication";

// requestAnalysis is the frozen contract's operationId; admitRun is its T06 handler.
export const admitRun = operation.mutation(
	"requestAnalysis",
	async (ctx, request) => ({
		resultKind: "run",
		resultId: await ctx.createRun({
			investigationId: request.investigationId,
			baseRevision: request.expectedRevision,
			driver: "backend",
			status: "admitted",
			purpose: request.purpose,
			...(request.budget ? { budget: request.budget } : {}),
			admittedAt: Date.now(),
		}),
	}),
);
/** Host admission shares the same atomic revision/epoch fence as backend admission.
 * A host's budget is declarative: this service never dispatches its model calls. */
export const beginHostRun = operation.mutation(
	"beginHostRun",
	async (ctx, request) => ({
		resultKind: "run",
		resultId: await ctx.createRun({
			investigationId: request.investigationId,
			baseRevision: request.expectedRevision,
			driver: "host",
			status: "admitted",
			purpose: request.purpose,
			...(request.budget ? { budget: request.budget } : {}),
			admittedAt: Date.now(),
		}),
	}),
);
export const getRun = operation.query("getRun", (ctx, request) =>
	ctx.run(request.runId),
);
export const cancelRun = operation.mutation(
	"cancelRun",
	async (ctx, request) => {
		await ctx.cancelRun(request.runId);
		return { resultKind: "run", resultId: request.runId };
	},
);

export const publish = internalMutation({ handler: publishRun });
