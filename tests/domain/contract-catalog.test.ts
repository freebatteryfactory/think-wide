import { expect, test } from "vitest";
import {
	CONTRACT_VERSION,
	OPERATION_HANDLERS,
	OPERATIONS,
} from "../../generated/operations";
import * as validators from "../../generated/validators.js";

test("catalog admission is generated, stateful and identity-free", () => {
	expect(CONTRACT_VERSION).toBe("0.7.0");
	const operation = OPERATIONS.find(
		(item) => item.operationId === "claimDemoAccess",
	);
	expect(operation).toMatchObject({
		effect: "state",
		exposure: ["http", "mcp"],
		envelopeKind: "projects",
	});
	expect(OPERATION_HANDLERS.claimDemoAccess).toBe("catalog:claimDemoAccess");
	expect(
		validators.ClaimDemoAccessRequest({ requestKey: "catalog-request" }),
	).toBe(true);
	for (const request of [
		{},
		{ requestKey: "catalog-request", owner: "other" },
		{ requestKey: "catalog-request", snapshotIds: ["private"] },
	])
		expect(validators.ClaimDemoAccessRequest(request)).toBe(false);
});
