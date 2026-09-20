import { operation } from "./lib/operation";

export const prepareHandoff = operation.mutation(
	"prepareHandoff",
	async (ctx, request) => ({
		resultKind: "handoff",
		resultId: await ctx.createHandoff(request),
	}),
);

export const readHandoff = operation.query("readHandoff", (ctx, request) =>
	ctx.handoffs.read(request),
);
