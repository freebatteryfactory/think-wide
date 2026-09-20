// The registry's handler bindings name real Convex registrations. Plain Node: the Convex
// modules are parsed with the TypeScript compiler API, never executed.
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vitest";
import {
	OPERATION_HANDLERS,
	OPERATIONS,
	type OperationId,
	UNIMPLEMENTED_OPERATIONS,
} from "../../generated/operations";

const convexDir = resolve(import.meta.dirname, "../../convex");

type Registration = {
	exportName: string;
	form: "query" | "mutation";
	operationId: string;
};

/** Every `export const X = operation.query|mutation("<id>", ...)` in one module. */
function registrations(path: string, text: string): Registration[] {
	const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
	const found: Registration[] = [];
	for (const statement of source.statements) {
		if (
			!ts.isVariableStatement(statement) ||
			!statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
		)
			continue;
		for (const declaration of statement.declarationList.declarations) {
			const call = declaration.initializer;
			if (
				!ts.isIdentifier(declaration.name) ||
				!call ||
				!ts.isCallExpression(call) ||
				!ts.isPropertyAccessExpression(call.expression) ||
				!ts.isIdentifier(call.expression.expression) ||
				call.expression.expression.text !== "operation"
			)
				continue;
			const form = call.expression.name.text;
			const id = call.arguments[0];
			if (
				(form !== "query" && form !== "mutation") ||
				!id ||
				!ts.isStringLiteral(id)
			)
				continue;
			found.push({
				exportName: declaration.name.text,
				form,
				operationId: id.text,
			});
		}
	}
	return found;
}

const moduleRegistrations = (module: string) => {
	const path = join(convexDir, `${module}.ts`);
	return registrations(path, readFileSync(path, "utf8"));
};

function publicModules(directory: string, prefix = ""): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		if (entry.isDirectory()) {
			if (entry.name === "_generated" || entry.name === "lib") return [];
			return publicModules(
				join(directory, entry.name),
				`${prefix}${entry.name}/`,
			);
		}
		return entry.isFile() && entry.name.endsWith(".ts")
			? [`${prefix}${entry.name.slice(0, -3)}`]
			: [];
	});
}

const bound = OPERATIONS.flatMap((o) =>
	"handler" in o ? [{ ...o, handler: o.handler as string }] : [],
);

describe("registry handler bindings", () => {
	test("the scanner recognises both forms and ignores everything else", () => {
		const found = registrations(
			"convex/probe.ts",
			[
				'export const a = operation.query("getRun", h);',
				'export const b = operation.mutation("cancelRun", h);',
				'const hidden = operation.query("getRun", h);',
				"export const c = internalMutation({ handler });",
				"export const d = operation.query(dynamicId, h);",
			].join("\n"),
		);
		expect(found).toEqual([
			{ exportName: "a", form: "query", operationId: "getRun" },
			{ exportName: "b", form: "mutation", operationId: "cancelRun" },
		]);
	});

	test("coverage scan retains nested modules and excludes private implementation directories", () => {
		const root = mkdtempSync(join(tmpdir(), "think-wide-handlers-"));
		try {
			for (const directory of ["nested/deeper", "_generated", "lib"])
				mkdirSync(join(root, directory), { recursive: true });
			for (const file of [
				"top.ts",
				"nested/deeper/public.ts",
				"_generated/api.ts",
				"lib/private.ts",
			])
				writeFileSync(
					join(root, file),
					'export const probe = operation.query("getRun", h);',
				);
			expect(publicModules(root).sort()).toEqual([
				"nested/deeper/public",
				"top",
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("handler map is derived from every bound registry operation", () => {
		expect(OPERATION_HANDLERS).toEqual(
			Object.fromEntries(bound.map((o) => [o.operationId, o.handler])),
		);
	});

	test.each(
		bound.map((o) => [o.operationId, o.handler, o.effect] as const),
	)("%s -> %s is a real export registered with the form its effect requires", (operationId, handler, effect) => {
		const [module, exportName, ...rest] = handler.split(":");
		expect(rest).toEqual([]);
		expect(module).toBeTruthy();
		expect(existsSync(join(convexDir, `${module}.ts`))).toBe(true);
		const registration = moduleRegistrations(module as string).find(
			(r) => r.exportName === exportName,
		);
		expect(
			registration,
			`${handler} is not an exported operation.* registration`,
		).toBeDefined();
		// The SAME operationId string, not merely a similarly named export.
		expect(registration?.operationId).toBe(operationId);
		expect(registration?.form).toBe(effect === "read" ? "query" : "mutation");
	});

	test("no two operations share a handler", () => {
		const handlers = bound.map((o) => o.handler);
		expect(new Set(handlers).size).toBe(handlers.length);
	});

	test("every public registration in convex/ is bound by exactly one operation", () => {
		const declared = new Set(bound.map((o) => o.handler));
		const actual = publicModules(convexDir).flatMap((module) =>
			moduleRegistrations(module).map((r) => `${module}:${r.exportName}`),
		);
		expect(actual.sort()).toEqual([...declared].sort());
	});

	test("UNIMPLEMENTED_OPERATIONS is exactly the operations without a handler", () => {
		const ids: OperationId[] = OPERATIONS.filter((o) => !("handler" in o)).map(
			(o) => o.operationId,
		);
		expect([...UNIMPLEMENTED_OPERATIONS]).toEqual(ids);
		expect(
			[
				...UNIMPLEMENTED_OPERATIONS,
				...(Object.keys(OPERATION_HANDLERS) as OperationId[]),
			].sort(),
		).toEqual(OPERATIONS.map((o) => o.operationId).sort());
	});
});
