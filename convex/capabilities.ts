import { OPERATION_LIMITS, SEARCH_CAPS } from "../core/limits";
import { CONTRACT_VERSION } from "../generated/operations";
import { operation } from "./lib/operation";
import { fail } from "./lib/validation";

export const getCapabilities = operation.query("getCapabilities", async () => {
	const mode = process.env.THINK_WIDE_MODE;
	if (mode !== "local-demo" && mode !== "connected") {
		return fail("capability_disabled", "Capabilities mode is not configured");
	}
	return {
		contractVersion: CONTRACT_VERSION,
		mode,
		authProfile:
			mode === "connected" ? "workos-authkit" : "local-fixed-principal",
		searchModes: [],
		limits: {
			searchHitsPerPage: SEARCH_CAPS.hitsPerPage,
			treeChildrenPerPage: OPERATION_LIMITS.treeChildrenPerPage,
			resultTextBytes: OPERATION_LIMITS.resultBytes,
			exactWindowBytes: OPERATION_LIMITS.exactWindowBytes,
			scanMaxFiles: SEARCH_CAPS.maxFiles,
			scanMaxBytes: SEARCH_CAPS.maxScanBytes,
			scanMaxMs: SEARCH_CAPS.wallClockMs,
		},
		integrations: {
			// I01 has verified WorkOS against a local backend, not the VPS.
			hostedIdentity: mode === "connected" ? "local_only" : "not_run",
			remoteMcp: "not_run",
			githubApp: "not_run",
			issuePublish: "disabled",
			backendReasoning: "disabled",
			outcomeIngestion: "disabled",
		},
	};
});
