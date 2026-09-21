import { OPERATION_LIMITS, SEARCH_CAPS } from "../core/limits";
import { CONTRACT_VERSION } from "../generated/operations";
import type { Capabilities } from "../generated/types";
import { Capabilities as isCapabilities } from "../generated/validators.js";
import { operation } from "./lib/operation";
import { fail, validate } from "./lib/validation";

export const getCapabilities = operation.query(
	"getCapabilities",
	async (ctx) => {
		const mode = process.env.THINK_WIDE_MODE;
		if (mode !== "local-demo" && mode !== "connected") {
			return fail("capability_disabled", "Capabilities mode is not configured");
		}
		const defaults: Capabilities["integrations"] = {
			hostedIdentity: "not_run",
			remoteMcp: "not_run",
			githubApp: "not_run",
			issuePublish: "disabled",
			backendReasoning: "disabled",
			outcomeIngestion: "disabled",
		};
		// Operator evidence belongs to this deployment, never to every connected install.
		// Keep unsupported integrations fixed and local-demo conservatively unproven.
		const integrations =
			mode === "connected"
				? {
						...defaults,
						hostedIdentity:
							process.env.THINK_WIDE_EVIDENCE_HOSTED_IDENTITY ??
							defaults.hostedIdentity,
						remoteMcp:
							process.env.THINK_WIDE_EVIDENCE_REMOTE_MCP ?? defaults.remoteMcp,
					}
				: defaults;
		const mcpIssuer =
			mode === "connected" ? process.env.MCP_AUTHORIZATION_SERVER : undefined;
		return validate<Capabilities>(
			isCapabilities,
			{
				contractVersion: CONTRACT_VERSION,
				mode,
				authProfile:
					mode === "local-demo"
						? "local-fixed-principal"
						: mcpIssuer && ctx.principal.id.startsWith(`${mcpIssuer}|`)
							? "workos-mcp-resource"
							: "workos-authkit",
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
				integrations,
			},
			true,
		);
	},
);
