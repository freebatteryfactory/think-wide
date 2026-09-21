// Contract 0.6.0: an MCP-exposed operation may bind a read-only MCP Apps view template.
// The acceptance half reads the committed generated tables. The rejection half runs the real
// generator on a mutated copy of the registry: an invalid binding must fail generation itself.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
	MCP_APP_MIME_TYPE,
	MCP_TOOLS,
	MCP_UI_RESOURCES,
} from "../../generated/mcp-tools";
import { CONTRACT_VERSION, OPERATIONS } from "../../generated/operations";

const root = resolve(import.meta.dirname, "../..");
const registryPath = join(root, "contracts/operations.json");
type Registry = {
	uiTemplates: Record<string, Record<string, unknown>>;
	operations: Array<Record<string, unknown>>;
};
const registry = (): Registry => JSON.parse(readFileSync(registryPath, "utf8"));
const scratch = mkdtempSync(join(tmpdir(), "tw-ui-binding-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let run = 0;
function generate(mutate: (value: Registry) => void) {
	const value = registry();
	mutate(value);
	const dir = join(scratch, String(++run));
	const file = join(scratch, `${run}.json`);
	writeFileSync(file, JSON.stringify(value));
	const result = spawnSync(
		"bun",
		[join(root, "scripts/codegen.ts"), dir, file],
		{ cwd: root, encoding: "utf8" },
	);
	return { status: result.status, stderr: result.stderr, dir };
}
const operation = (value: Registry, id: string) => {
	const found = value.operations.find((item) => item.operationId === id);
	if (!found) throw new Error(`Missing ${id}`);
	return found;
};

describe("accepted binding", () => {
	test("contract is 0.6.0 and only bound operations carry ui", () => {
		expect(CONTRACT_VERSION).toBe("0.6.0");
		const bound = OPERATIONS.filter((item) => "ui" in item);
		expect(bound.map((item) => item.operationId)).toEqual([
			"readInvestigation",
		]);
		for (const item of bound) {
			expect(Object.keys(item.ui)).toEqual(["template"]);
			expect((item.exposure as readonly string[]).includes("mcp")).toBe(true);
			expect(MCP_UI_RESOURCES.map((view) => view.template)).toContain(
				item.ui.template,
			);
		}
	});

	test("tool _meta and resource descriptors are projections of the registry", () => {
		const templates = registry().uiTemplates;
		expect(MCP_UI_RESOURCES.map((view) => view.template)).toEqual(
			Object.keys(templates),
		);
		for (const view of MCP_UI_RESOURCES) {
			const source = templates[view.template];
			expect(view.uri).toBe(source?.uri);
			expect(view.uri.startsWith("ui://")).toBe(true);
			expect(view.title).toBe(source?.title);
			expect(view.description).toBe(source?.description);
			expect(view.mimeType).toBe(MCP_APP_MIME_TYPE);
			// No external origin is declared: the view loads nothing and connects nowhere.
			expect(view._meta.ui.csp).toEqual({
				connectDomains: [],
				resourceDomains: [],
			});
		}
		expect(MCP_APP_MIME_TYPE).toBe("text/html;profile=mcp-app");
		for (const tool of MCP_TOOLS) {
			const op = OPERATIONS.find((item) => item.operationId === tool.name);
			if (op && "ui" in op) {
				const uri = MCP_UI_RESOURCES.find(
					(view) => view.template === op.ui.template,
				)?.uri;
				expect("_meta" in tool && tool._meta).toEqual({
					ui: { resourceUri: uri },
					"openai/outputTemplate": uri,
				});
			} else expect("_meta" in tool).toBe(false);
		}
	});

	test("the generator accepts the committed registry from an explicit path", () => {
		const result = generate(() => {});
		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
		expect(readFileSync(join(result.dir, "mcp-tools.ts"), "utf8")).toBe(
			readFileSync(join(root, "generated/mcp-tools.ts"), "utf8"),
		);
	});
});

describe("rejected binding: generation fails", () => {
	test.each<[string, (value: Registry) => void, RegExp]>([
		[
			"unknown template",
			(value) => {
				operation(value, "readInvestigation").ui = { template: "dashboard" };
			},
			/readInvestigation: unknown ui template dashboard/,
		],
		[
			"extra property on the binding",
			(value) => {
				operation(value, "readInvestigation").ui = {
					template: "investigation",
					resourceUri: "ui://evil/x.html",
				};
			},
			/readInvestigation: ui: unknown properties \[resourceUri\]/,
		],
		[
			"binding that is not an object",
			(value) => {
				operation(value, "readInvestigation").ui = "investigation";
			},
			/readInvestigation: ui: must be an object/,
		],
		[
			"extra property on a template",
			(value) => {
				const template = value.uiTemplates.investigation;
				if (template) template.csp = { connectDomains: ["evil.example"] };
			},
			/uiTemplates\.investigation: unknown properties \[csp\]/,
		],
		[
			"template URI outside ui://think-wide/",
			(value) => {
				const template = value.uiTemplates.investigation;
				if (template) template.uri = "ui://other-server/investigation.html";
			},
			/uiTemplates\.investigation: uri must match/,
		],
		[
			"template URI with a web scheme",
			(value) => {
				const template = value.uiTemplates.investigation;
				if (template) template.uri = "web://think-wide/investigation.html";
			},
			/uiTemplates\.investigation: uri must match/,
		],
		[
			"binding on an operation that is not MCP-exposed",
			(value) => {
				operation(value, "requestAnalysis").ui = { template: "investigation" };
			},
			/requestAnalysis: ui is only valid on an MCP-exposed operation/,
		],
		[
			"template that no operation binds",
			(value) => {
				delete operation(value, "readInvestigation").ui;
			},
			/uiTemplates\.investigation: not bound by any operation/,
		],
	])("%s", (_name, mutate, message) => {
		const result = generate(mutate);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toMatch(message);
	});
});
