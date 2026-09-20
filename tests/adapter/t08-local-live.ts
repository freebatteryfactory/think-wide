/** Explicit live acceptance: bun tests/adapter/t08-local-live.ts.
 * Requires local:setup first. Creates synthetic investigation/decision/brief rows.
 * Never runs as part of fixture-only CI and never uses admin credentials.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { importJWK, SignJWT } from "jose";
import { validateResponse } from "../../convex/lib/validation";
import { MCP_TOOL_NAMES } from "../../generated/mcp-tools";
import type {
	OperationId,
	OperationRequestMap,
	OperationResponseMap,
} from "../../generated/operations";
import type { Project, SnapshotEntry } from "../../generated/types";
import * as validators from "../../generated/validators.js";
import {
	LOCAL_AUDIENCE,
	LOCAL_ISSUER,
	localIssuer,
} from "../../src/server/auth/local-issuer";
import { serverConfig } from "../../src/server/config";
import { createMcpServer } from "../../src/server/mcp/server";
import { ALPHA_TS } from "../fixtures/repos/cases";

const config = serverConfig();
assert.equal(config.mode, "local-demo");
assert.notEqual(process.env.NODE_ENV, "production");
const root = fileURLToPath(new URL("../../", import.meta.url));
const issuer = await localIssuer();
const ownerToken = await issuer.mint();
// Test-only second principal under the same trusted local issuer. The production
// issuer API remains fixed-principal; this harness is never a public endpoint.
const jwk = JSON.parse(
	await readFile(
		new URL(
			"../../infra/.data/local-identity/signing-key.json",
			import.meta.url,
		),
		"utf8",
	),
);
const otherToken = await new SignJWT({})
	.setProtectedHeader({ alg: "RS256", kid: jwk.kid })
	.setIssuer(LOCAL_ISSUER)
	.setAudience(LOCAL_AUDIENCE)
	.setSubject("local-setup-qa-other")
	.setIssuedAt()
	.setExpirationTime("5m")
	.sign(await importJWK(jwk, "RS256"));

const client = new Client({ name: "t08-live-acceptance", version: "1" });
const transport = new StdioClientTransport({
	command: "bun",
	args: ["--no-env-file", "src/server/mcp/stdio.ts"],
	cwd: root,
	env: {
		THINK_WIDE_MODE: "local-demo",
		CONVEX_SELF_HOSTED_URL: config.convexUrl,
	},
	stderr: "pipe",
});
const other = new Client({ name: "t08-live-other-principal", version: "1" });
const otherServer = createMcpServer(async () => otherToken);
const [otherClientTransport, otherServerTransport] =
	InMemoryTransport.createLinkedPair();

async function raw(
	target: Client,
	name: string,
	args: Record<string, unknown>,
) {
	return (await target.callTool({ name, arguments: args })).structuredContent;
}
async function call<K extends OperationId>(
	name: K,
	args: OperationRequestMap[K],
): Promise<OperationResponseMap[K]> {
	const value = await raw(client, name, { ...args });
	validateResponse(name, value);
	return value as OperationResponseMap[K];
}
function projects(value: unknown): Project[] {
	assert(validators.ResultEnvelope(value));
	const entries = (value as { entries: unknown[] }).entries;
	return entries.map((entry) => {
		assert(validators.Project(entry));
		return entry as Project;
	});
}
function entries(value: unknown): SnapshotEntry[] {
	assert(validators.ResultEnvelope(value));
	return (value as { entries: unknown[] }).entries.map((entry) => {
		assert(validators.SnapshotEntry(entry));
		return entry as SnapshotEntry;
	});
}
const key = `local-live-${crypto.randomUUID()}`;
try {
	await client.connect(transport);
	await otherServer.connect(otherServerTransport);
	await other.connect(otherClientTransport);
	assert.deepEqual(
		(await client.listTools()).tools.map((tool) => tool.name),
		MCP_TOOL_NAMES,
	);
	const portfolio = projects(await call("listProjects", {}));
	const alpha = portfolio.find(
		(project) => project.repositoryId === "local-demo-alpha",
	);
	const beta = portfolio.find(
		(project) => project.repositoryId === "local-demo-beta",
	);
	assert(alpha && beta);
	assert.equal(projects(await raw(other, "listProjects", {})).length, 0);
	console.log(
		`PASS tools/list (${MCP_TOOL_NAMES.length}); owner sees alpha/beta; other principal sees zero projects`,
	);
	const snapshotId = alpha.snapshots[0]?.snapshotId;
	assert(snapshotId);
	const tree = entries(await call("browseSnapshot", { snapshotId }));
	const src = tree.find((entry) => entry.name === "src");
	assert(src);
	const leaf = entries(
		await call("browseSnapshot", { snapshotId, parentEntryId: src.entryId }),
	).find((entry) => entry.name === "alpha.ts");
	assert(leaf);
	const source = await call("readSource", {
		snapshotId,
		entryId: leaf.entryId,
	});
	assert.equal(source.content, ALPHA_TS);
	const foreign = await raw(other, "readSource", {
		snapshotId,
		entryId: leaf.entryId,
	});
	assert(validators.OperationError(foreign));
	assert.equal((foreign as { code: string }).code, "not_found");
	console.log(
		"PASS exact fixture bytes through real stdio MCP; foreign source denied",
	);
	const request = {
		question: "Local setup end-to-end evidence",
		snapshotIds: [snapshotId] as [string],
		requestKey: `${key}-open`,
	};
	const investigation = await call("openInvestigation", request);
	assert.equal(
		(await call("openInvestigation", request)).investigationId,
		investigation.investigationId,
	);
	assert.equal(
		(
			(await raw(client, "openInvestigation", {
				...request,
				question: "Changed",
			})) as { code: string }
		).code,
		"request_key_conflict",
	);
	const run = await call("beginHostRun", {
		investigationId: investigation.investigationId,
		expectedRevision: 0,
		purpose: "Verify admission fencing",
		requestKey: `${key}-admit`,
	});
	const decisionRequest: OperationRequestMap["recordDecision"] = {
		investigationId: investigation.investigationId,
		expectedRevision: 0,
		kind: "correction" as const,
		statement: "Keep the exact fixture bytes and durable correction",
		refs: [source.ref],
		requestKey: `${key}-decide`,
	};
	const decision = await call("recordDecision", decisionRequest);
	assert.equal(
		(await call("recordDecision", decisionRequest)).decisionId,
		decision.decisionId,
	);
	assert.equal(
		(
			(await raw(client, "recordDecision", {
				...decisionRequest,
				statement: "Changed",
			})) as { code: string }
		).code,
		"request_key_conflict",
	);
	const read = await call("readInvestigation", {
		investigationId: investigation.investigationId,
	});
	assert.equal(read.revision, 1);
	assert(
		read.decisions?.some((item) => item.decisionId === decision.decisionId),
	);
	assert.equal(
		(await call("getRun", { runId: run.runId })).status,
		"superseded",
	);
	const late = await raw(client, "submitProposal", {
		proposal: {
			investigationId: investigation.investigationId,
			runId: run.runId,
			baseRevision: 0,
			claims: [
				{
					statement: "Late host proposal",
					evidenceClass: "model_hypothesis",
					refs: [source.ref],
				},
			],
		},
		requestKey: `${key}-late`,
	});
	assert.equal((late as { code: string }).code, "revision_conflict");
	const freshRun = await call("beginHostRun", {
		investigationId: investigation.investigationId,
		expectedRevision: 1,
		purpose: "Publish current revision",
		requestKey: `${key}-fresh-admit`,
	});
	const proposal: OperationRequestMap["submitProposal"] = {
		proposal: {
			investigationId: investigation.investigationId,
			runId: freshRun.runId,
			baseRevision: 1,
			claims: [
				{
					statement: "Exact source remains available",
					evidenceClass: "model_hypothesis" as const,
					refs: [source.ref],
				},
			],
		},
		requestKey: `${key}-submit`,
	};
	const published = await call("submitProposal", proposal);
	assert.equal(published.revision, 1);
	assert.equal(published.acceptedFindings?.length, 1);
	assert.equal(
		(await call("submitProposal", proposal)).acceptedFindings?.[0]?.findingId,
		published.acceptedFindings?.[0]?.findingId,
	);
	const brief = await call("prepareHandoff", {
		investigationId: investigation.investigationId,
		expectedRevision: 1,
		targetRepositoryId: alpha.repositoryId,
		audience: "private_download",
		requestKey: `${key}-brief`,
	});
	const handoff = await call("readHandoff", { handoffId: brief.handoffId });
	assert(
		"bodyMarkdown" in handoff &&
			handoff.bodyMarkdown.includes(decisionRequest.statement),
	);
	console.log(
		"PASS open/replay/conflict; decision revision 1; stale run fenced; fresh proposal/replay; brief retains correction",
	);
	// Use public HTTP APIs even for internal names. No admin auth is present.
	for (const token of [undefined, ownerToken, otherToken]) {
		for (const name of ["registerSnapshot", "cacheSource", "cacheHistory"]) {
			const response = await fetch(`${config.convexUrl}/api/mutation`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
				body: JSON.stringify({
					path: `operatorProvisioning:${name}`,
					args: {
						ownerTokenIdentifier: `${LOCAL_ISSUER}|forged-recipient`,
						input: {},
					},
					format: "json",
				}),
			});
			const result = await response.json();
			assert.equal(result.status, "error");
			assert.match(result.errorMessage, /Could not find public function/);
		}
	}
	console.log(
		"PASS all three internal provisioning functions inaccessible: no token, owner JWT, other-user JWT",
	);
	console.log(
		`Evidence investigation: ${investigation.investigationId}; handoff: ${brief.handoffId}`,
	);
} finally {
	await client.close();
	await other.close();
	await otherServer.close();
}
