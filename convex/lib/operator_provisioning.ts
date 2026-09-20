import type { Principal } from "../../core";
import type { MutationCtx } from "../_generated/server";
import { fail } from "./validation";

/** Operator recipient, not caller authentication. This function never verifies a
 * person's identity; Convex internal visibility is the administrative boundary.
 * Public/user-context invocations cannot use this provisioning exception.
 */
export async function provisioningRecipient(
	ctx: Pick<MutationCtx, "auth">,
	args: { ownerTokenIdentifier: string; input: unknown },
): Promise<Principal> {
	if (await ctx.auth.getUserIdentity())
		return fail("not_found", "Resource not found");
	if (
		Object.keys(args).length !== 2 ||
		!("input" in args) ||
		typeof args.ownerTokenIdentifier !== "string"
	) {
		return invalidRecipient();
	}
	const value = args.ownerTokenIdentifier;
	if (value.length > 2048 || !/^https?:\/\/[^|\s]+\|[^|\s]+$/.test(value))
		return invalidRecipient();
	const issuer = value.slice(0, value.indexOf("|"));
	try {
		const url = new URL(issuer);
		if (
			!url.hostname ||
			url.username ||
			url.password ||
			url.search ||
			url.hash ||
			(url.protocol === "http:" &&
				!["127.0.0.1", "[::1]", "localhost"].includes(url.hostname))
		)
			return invalidRecipient();
	} catch {
		return invalidRecipient();
	}
	// Preserve the issuer and subject byte-for-byte; normalization changes identity.
	return { id: value };
}

function invalidRecipient(): never {
	return fail("invalid_request", "Invalid provisioning recipient", {
		details: [
			{
				path: "/ownerTokenIdentifier",
				problem:
					"Expected a full issuer|subject tokenIdentifier (HTTPS issuer or loopback HTTP), without credentials or whitespace",
			},
		],
	});
}
