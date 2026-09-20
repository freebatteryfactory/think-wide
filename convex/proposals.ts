import { operation } from "./lib/operation";

export const submitProposal = operation.mutation(
	"submitProposal",
	async (ctx, request) => ({
		resultKind: "investigation",
		resultId: await ctx.submitProposal(request.proposal),
	}),
);
