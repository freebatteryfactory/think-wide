import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, test } from "vitest";

// I01 / AGENTS.md rule 12: browser code never holds a server credential. Everything under
// src/components, src/integrations, src/lib and src/routes ships to (or is reachable from)
// the browser bundle, EXCEPT src/routes/api/** and the strictly checked OAuth
// metadata route, whose handlers are server-only.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SERVER_DIR = join(ROOT, "src", "server");
const BROWSER_DIRS = [
	"src/components",
	"src/integrations",
	"src/lib",
	"src/routes",
];
const SERVER_ONLY_ROUTES = join(ROOT, "src", "routes", "api") + sep;

const METADATA_ROUTE = join(
	ROOT,
	"src",
	"routes",
	"[.]well-known.oauth-protected-resource.ts",
);

// OAuth metadata must be at the standard root URL, outside /api. Exempt only
// this exact route and only its allowlisted server-only module shape.
function serverOnlyMetadataRoute(path: string, text: string): boolean {
	if (path !== METADATA_ROUTE) return false;
	const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
	const declarations = source.statements.filter(ts.isVariableStatement);
	if (declarations.length !== 1 || source.statements.length !== 3) return false;
	const statement = declarations[0];
	if (
		statement.modifiers?.length !== 1 ||
		statement.modifiers[0].kind !== ts.SyntaxKind.ExportKeyword ||
		!(statement.declarationList.flags & ts.NodeFlags.Const) ||
		statement.declarationList.declarations.length !== 1
	)
		return false;
	const declaration = statement.declarationList.declarations[0];
	if (
		!ts.isIdentifier(declaration.name) ||
		declaration.name.text !== "Route" ||
		!declaration.initializer ||
		!ts.isCallExpression(declaration.initializer)
	)
		return false;
	const call = declaration.initializer;
	const factory = call.expression;
	if (
		!ts.isCallExpression(factory) ||
		!ts.isIdentifier(factory.expression) ||
		factory.expression.text !== "createFileRoute" ||
		factory.arguments.length !== 1 ||
		!ts.isStringLiteral(factory.arguments[0]) ||
		factory.arguments[0].text !== "/.well-known/oauth-protected-resource" ||
		call.arguments.length !== 1 ||
		!ts.isObjectLiteralExpression(call.arguments[0])
	)
		return false;
	const options = call.arguments[0].properties;
	if (
		options.length !== 1 ||
		!ts.isPropertyAssignment(options[0]) ||
		!ts.isIdentifier(options[0].name) ||
		options[0].name.text !== "server" ||
		!ts.isObjectLiteralExpression(options[0].initializer)
	)
		return false;
	const allowedImports = new Map([
		["@tanstack/react-router", "createFileRoute"],
		["../server/http", "protectedResourceMetadata"],
	]);
	for (const node of source.statements) {
		if (node === statement) continue;
		if (
			!ts.isImportDeclaration(node) ||
			!ts.isStringLiteral(node.moduleSpecifier)
		)
			return false;
		const expected = allowedImports.get(node.moduleSpecifier.text);
		const bindings = node.importClause?.namedBindings;
		if (
			!expected ||
			node.importClause?.name ||
			!bindings ||
			!ts.isNamedImports(bindings) ||
			bindings.elements.length !== 1 ||
			bindings.elements[0].propertyName ||
			bindings.elements[0].name.text !== expected
		)
			return false;
		allowedImports.delete(node.moduleSpecifier.text);
	}
	return allowedImports.size === 0;
}

const FORBIDDEN_PACKAGES = ["@workos-inc/node"];
const SERVER_ENV_NAMES = [
	"WORKOS_API_KEY",
	"WORKOS_COOKIE_PASSWORD",
	"CONVEX_SELF_HOSTED_ADMIN_KEY",
];

function walk(directory: string, keep: (path: string) => boolean): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			return walk(path, keep);
		}
		return keep(path) ? [path] : [];
	});
}

function browserFiles(): string[] {
	return BROWSER_DIRS.flatMap((directory) =>
		walk(join(ROOT, directory), (path) => /\.[cm]?tsx?$/.test(path)),
	).filter(
		(path) =>
			!path.startsWith(SERVER_ONLY_ROUTES) &&
			!serverOnlyMetadataRoute(path, readFileSync(path, "utf8")),
	);
}

function moduleSpecifiers(path: string, text: string): string[] {
	const found: string[] = [];
	const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
	function visit(node: ts.Node) {
		if (
			(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
			node.moduleSpecifier &&
			ts.isStringLiteral(node.moduleSpecifier)
		) {
			found.push(node.moduleSpecifier.text);
		}
		if (
			ts.isCallExpression(node) &&
			(node.expression.kind === ts.SyntaxKind.ImportKeyword ||
				(ts.isIdentifier(node.expression) &&
					node.expression.text === "require"))
		) {
			const [argument] = node.arguments;
			if (argument && ts.isStringLiteralLike(argument)) {
				found.push(argument.text);
			} else {
				// A computed specifier cannot be checked, so it is not allowed here.
				found.push("<computed>");
			}
		}
		if (
			ts.isImportTypeNode(node) &&
			ts.isLiteralTypeNode(node.argument) &&
			ts.isStringLiteral(node.argument.literal)
		) {
			found.push(node.argument.literal.text);
		}
		ts.forEachChild(node, visit);
	}
	visit(source);
	return found;
}

function reachesServer(fromFile: string, specifier: string): boolean {
	const alias = /^[#@]\/(.*)$/.exec(specifier);
	const target = alias
		? join(ROOT, "src", alias[1] ?? "")
		: specifier.startsWith(".")
			? resolve(dirname(fromFile), specifier)
			: undefined;
	if (!target) {
		return false;
	}
	return target === SERVER_DIR || target.startsWith(SERVER_DIR + sep);
}

function violations(path: string, text: string): string[] {
	const label = relative(ROOT, path);
	const out: string[] = [];
	for (const specifier of moduleSpecifiers(path, text)) {
		if (specifier === "<computed>") {
			out.push(`${label}: computed import specifier`);
		}
		if (
			FORBIDDEN_PACKAGES.some(
				(name) => specifier === name || specifier.startsWith(`${name}/`),
			)
		) {
			out.push(`${label}: imports ${specifier}`);
		}
		if (reachesServer(path, specifier)) {
			out.push(`${label}: imports trusted server code (${specifier})`);
		}
	}
	for (const name of SERVER_ENV_NAMES) {
		if (text.includes(name)) {
			out.push(`${label}: mentions ${name}`);
		}
	}
	return out;
}

describe("I01 browser boundary", () => {
	test("the detector rejects each forbidden shape", () => {
		const probe = join(ROOT, "src", "components", "shell", "Probe.tsx");
		const bad: Array<[string, string]> = [
			['import { WorkOS } from "@workos-inc/node";', "@workos-inc/node"],
			[
				'const m = await import("@workos-inc/node/worker");',
				"@workos-inc/node",
			],
			['import { dispatch } from "../../server/ops/dispatch";', "server"],
			['import { x } from "#/server/config";', "server"],
			['import { x } from "@/server/convex-client";', "server"],
			['export * from "../../server/auth/workos";', "server"],
			['type T = import("../../server/config").Config;', "server"],
			['const m = require("../../server/config");', "server"],
			["const m = await import(name);", "computed"],
			["const k = process.env.WORKOS_API_KEY;", "WORKOS_API_KEY"],
			['const k = process.env["WORKOS_COOKIE_PASSWORD"];', "WORKOS_COOKIE"],
			[
				"const k = import.meta.env.CONVEX_SELF_HOSTED_ADMIN_KEY;",
				"CONVEX_SELF_HOSTED_ADMIN_KEY",
			],
		];
		for (const [text, expected] of bad) {
			const found = violations(probe, text);
			expect(found, text).toHaveLength(1);
			expect(found[0], text).toContain(expected);
		}
		const fine = [
			'import { useAuth } from "@workos/authkit-tanstack-react-start/client";',
			'import { api } from "../../../convex/_generated/api";',
			'import { browserIdentityMode } from "../../lib/identity-mode";',
			'import { serverless } from "../../serverless/thing";',
		].join("\n");
		expect(violations(probe, fine)).toEqual([]);
	});

	test("only API routes and the checked server-only metadata route are exempt", () => {
		const files = browserFiles().map((path) => relative(ROOT, path));
		expect(files).toContain(join("src", "routes", "__root.tsx"));
		expect(files).toContain(
			join("src", "components", "shell", "AuthIndicator.tsx"),
		);
		expect(files).toContain(
			join("src", "integrations", "convex", "provider.tsx"),
		);
		expect(
			files.some((path) => path.startsWith(join("src", "routes", "api"))),
		).toBe(false);
	});

	test("metadata exemption rejects client options, spreads, computed keys and exports", () => {
		const source = readFileSync(METADATA_ROUTE, "utf8");
		expect(serverOnlyMetadataRoute(METADATA_ROUTE, source)).toBe(true);
		expect(
			serverOnlyMetadataRoute(join(ROOT, "src/routes/other.ts"), source),
		).toBe(false);
		for (const addition of [
			"component: () => null,",
			"loader: () => null,",
			"beforeLoad: () => null,",
			"unknownOption: true,",
			"...extra,",
		]) {
			expect(
				serverOnlyMetadataRoute(
					METADATA_ROUTE,
					source.replace("server:", `${addition} server:`),
				),
				addition,
			).toBe(false);
		}
		for (const changed of [
			source.replace("server:", '["server"]:'),
			`${source}\nexport const Other = 1;`,
			`${source}\nexport default Route;`,
			source.replace(
				"import { protectedResourceMetadata }",
				"import * as protectedResourceMetadata",
			),
			source.replace("export const Route", "const Route"),
		]) {
			expect(serverOnlyMetadataRoute(METADATA_ROUTE, changed)).toBe(false);
		}
	});

	test("no browser file imports @workos-inc/node or src/server, or names a server credential", () => {
		const found = browserFiles().flatMap((path) =>
			violations(path, readFileSync(path, "utf8")),
		);
		expect(found).toEqual([]);
	});
});

// Vite inlines every VITE_* variable into the public bundle. A credential under such a name
// is published. Names only: values are never read into a failure message.
const SECRET_WORDS = /KEY|SECRET|TOKEN|PASSWORD/;
const SKIP_DIRECTORIES = new Set([
	"node_modules",
	".git",
	".output",
	".nitro",
	".tanstack",
	".vinxi",
	"dist",
	"coverage",
	".data",
]);
const TEXT_FILE =
	/(\.([cm]?[jt]sx?|json|md|ya?ml|toml|css|html|sh|txt)|(^|\/)\.env[^/]*|(^|\/)Dockerfile[^/]*|(^|\/)Caddyfile)$/;

function viteNames(text: string): string[] {
	return text.match(/\bVITE_[A-Z0-9_]+/g) ?? [];
}

function repositoryTextFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			return SKIP_DIRECTORIES.has(entry.name) ? [] : repositoryTextFiles(path);
		}
		return entry.isFile() && TEXT_FILE.test(path) ? [path] : [];
	});
}

describe("I01 public build variables", () => {
	// Assembled at run time so that this file does not itself contain a forbidden name.
	const prefix = ["VITE", ""].join("_");

	test("the detector flags credential-shaped names and accepts the real ones", () => {
		for (const word of [
			"API_KEY",
			"CLIENT_SECRET",
			"ACCESS_TOKEN",
			"COOKIE_PASSWORD",
		]) {
			const name = `${prefix}WORKOS_${word}`;
			expect(viteNames(`x ${name}=1`)).toEqual([name]);
			expect(SECRET_WORDS.test(name)).toBe(true);
		}
		for (const name of [
			`${prefix}CONVEX_URL`,
			`${prefix}THINK_WIDE_IDENTITY`,
		]) {
			expect(SECRET_WORDS.test(name)).toBe(false);
		}
	});

	test("no VITE_* name anywhere in the repository contains KEY, SECRET, TOKEN or PASSWORD", () => {
		const files = repositoryTextFiles(ROOT);
		expect(files.length).toBeGreaterThan(50);
		expect(files.map((path) => relative(ROOT, path))).toContain(".env.example");
		const names = new Map<string, string>();
		for (const path of files) {
			for (const name of viteNames(readFileSync(path, "utf8"))) {
				if (!names.has(name)) {
					names.set(name, relative(ROOT, path));
				}
			}
		}
		expect([...names.keys()]).toContain(`${prefix}CONVEX_URL`);
		expect([...names.keys()]).toContain(`${prefix}THINK_WIDE_IDENTITY`);
		const offending = [...names]
			.filter(([name]) => SECRET_WORDS.test(name))
			.map(([name, path]) => `${name} (first seen in ${path})`);
		expect(offending).toEqual([]);
	});
});
