import { OPERATION_LIMITS } from "../../core/limits";
import { canonicalArguments, type Principal } from "../../core";
import type {
	ImplementedOperationId,
	OperationRequestMap,
	OperationResponseMap,
	ReadOperationId,
	StateOperationId,
} from "../../generated/operations";
import type { Decision, HandoffSummary, Investigation, Run, ResultEnvelope } from "../../generated/types";
import * as validators from "../../generated/validators.js";
import { mutation, type QueryCtx, query } from "../_generated/server";
import {
	AuthorizedCtx,
	AuthorizedMutationCtx,
	requirePrincipal,
} from "./authz";
import { type ResultId, reserveReceipt } from "./receipts";
import {
	fail,
	operationDefinition,
	validate,
	validateResponse,
} from "./validation";

// Operation shapes and effect classes come from the registry (generated/operations.ts),
// restricted to the operations that have a handler binding. Nothing is restated here.
type Requests = Pick<OperationRequestMap, ImplementedOperationId>;
type Responses = Pick<OperationResponseMap, ImplementedOperationId>;
type StateOperation = Extract<StateOperationId, ImplementedOperationId>;
type ReadOperation = Extract<ReadOperationId, ImplementedOperationId>;

function requestFor<K extends keyof Requests>(
	id: K,
	args: { request: unknown },
): Requests[K] {
	if (Object.keys(args).length !== 1 || !("request" in args))
		fail("invalid_request", "Expected a single request argument", {
			details: [{ path: "/", problem: "Expected a single request argument" }],
		});
	let encoded: string;
	try {
		encoded = canonicalArguments(args.request);
	} catch {
		return fail("invalid_request", "Invalid JSON request", {
			details: [
				{ path: "/request", problem: "Invalid JSON or maximum depth exceeded" },
			],
		});
	}
	if (new TextEncoder().encode(encoded).length > OPERATION_LIMITS.requestBytes)
		fail("invalid_request", "Request exceeds size limit", {
			details: [
				{ path: "/request", problem: "Maximum request size is 128 KiB" },
			],
		});
	const request = validate<Requests[K]>(
		validators[operationDefinition(id).requestType],
		args.request,
	);
	if (
		"expectedRevision" in request &&
		request.expectedRevision >= Number.MAX_SAFE_INTEGER
	)
		fail("invalid_request", "Revision exceeds safe range", {
			details: [
				{
					path: "/expectedRevision",
					problem: "Revision must permit an exact increment",
				},
			],
		});
	return request;
}

async function authorize(
	ctx: AuthorizedCtx,
	request: Requests[keyof Requests],
): Promise<void> {
	if ("proposal" in request) await ctx.authorizeProposal(request.proposal);
	if ("snapshotId" in request) {
		await ctx.loadAuthorized("snapshot", request.snapshotId);
	}
	if ("snapshotIds" in request)
		for (const snapshotId of request.snapshotIds)
			await ctx.requireAccess("snapshot", snapshotId);
	if ("investigationId" in request) {
		const investigation = await ctx.investigation(request.investigationId);
		if ("kind" in request) await ctx.authorizeDecision(request, investigation);
	}
	if ("runId" in request) await ctx.loadAuthorized("run", request.runId);
}

async function reread(
	ctx: AuthorizedCtx,
	result: ResultId,
): Promise<Investigation | Decision | Run | HandoffSummary | ResultEnvelope> {
	if (result.resultKind === "catalog") return ctx.readCatalogClaim(result.resultId);
	if (result.resultKind === "investigation")
		return ctx.readInvestigation({ investigationId: result.resultId });
	if (result.resultKind === "decision") return ctx.decision(result.resultId);
	if (result.resultKind === "handoff") return ctx.handoffs.summary(result.resultId);
	return ctx.run(result.resultId);
}

function responseFor<K extends keyof Responses>(
	id: K,
	response: unknown,
): Responses[K] {
	validateResponse(id, response);
	if (
		new TextEncoder().encode(JSON.stringify(response)).length >
		OPERATION_LIMITS.resultBytes
	)
		fail("limit_exceeded", "Operation response exceeds 16 KiB");
	return response as Responses[K];
}

type Receipt = Awaited<ReturnType<typeof reserveReceipt>>;

/** One execution pipeline for queries and mutations, including receipt replay. */
async function execute<K extends keyof Requests, C extends AuthorizedCtx>(
	raw: QueryCtx,
	args: { request: unknown },
	id: K,
	createContext: (principal: Principal) => C,
	invoke: (
		ctx: C,
		request: Requests[K],
	) => Promise<{ response: unknown; result?: ResultId }>,
	reserve?: (principal: Principal, request: Requests[K]) => Promise<Receipt>,
): Promise<Responses[K]> {
	const request = requestFor(id, args);
	const principal = await requirePrincipal(raw);
	const receipt = await reserve?.(principal, request);
	const ctx = createContext(principal);
	await authorize(ctx, request);
	let outcome: { response: unknown; result?: ResultId };
	if (receipt?.previous) {
		// Reauthorize even a conflicting receipt before exposing its outcome.
		outcome = { response: await reread(ctx, receipt.previous) };
		receipt.compare();
	} else {
		outcome = await invoke(ctx, request);
	}
	const response = responseFor(id, outcome.response);
	if (receipt && !receipt.previous) {
		if (!outcome.result)
			fail("internal", "Mutation did not return a result identifier");
		await receipt.finalize(outcome.result);
	}
	return response;
}

/** Both registration forms use the pipeline above. Generated Ajv validators are the
 * sole public shape authority; Convex's optional shape validators are deliberately
 * not duplicated here. The raw boundary is unknown, never an unchecked domain type.
 */
export const operation = {
	query<K extends ReadOperation>(
		id: K,
		handler: (
			ctx: AuthorizedCtx,
			request: Requests[K],
		) => Promise<Responses[K]>,
	) {
		if (operationDefinition(id).effect !== "read")
			throw new Error("Operation must be a query");
		return query({
			handler: (raw, args: { request: unknown }): Promise<Responses[K]> =>
				execute(
					raw,
					args,
					id,
					(principal) => new AuthorizedCtx(raw, principal, id),
					async (ctx, request) => ({ response: await handler(ctx, request) }),
				),
		});
	},
	mutation<K extends StateOperation>(
		id: K,
		handler: (
			ctx: AuthorizedMutationCtx,
			request: Requests[K],
		) => Promise<ResultId>,
	) {
		if (operationDefinition(id).effect !== "state")
			throw new Error("Operation must be a mutation");
		return mutation({
			handler: (raw, args: { request: unknown }): Promise<Responses[K]> =>
				execute(
					raw,
					args,
					id,
					(principal) => new AuthorizedMutationCtx(raw, principal, id),
					async (ctx, request) => {
						const result = await handler(ctx, request);
						return { result, response: await reread(ctx, result) };
					},
					(principal, request) =>
						reserveReceipt(raw, principal, id, request.requestKey, request),
				),
		});
	},
};
