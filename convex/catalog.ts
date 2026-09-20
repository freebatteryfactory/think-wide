import { operation } from "./lib/operation";

export const claimDemoAccess = operation.mutation(
	"claimDemoAccess",
	async (ctx) => ({
		resultKind: "catalog",
		resultId: await ctx.claimDemoAccess(),
	}),
);
