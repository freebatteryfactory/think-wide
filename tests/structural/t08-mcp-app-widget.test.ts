// Every MCP Apps view is one self-contained, read-only document. Tool results are untrusted data
// (rule 11), so a view may not contain an HTML sink, dynamic code, an external reference, or a way
// to call a tool. The list of views comes from the generated table, not from this file.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { MCP_UI_RESOURCES } from "../../generated/mcp-tools";

const dir = "src/server/mcp/apps";
const forbidden: Array<[string, RegExp]> = [
	["web reference", /https?:\/\//i],
	["protocol-relative reference", /(src|href)\s*=\s*["']?\/\//i],
	["eval", /\beval\s*\(/],
	["Function constructor", /\bnew\s+Function\b|\bFunction\s*\(/],
	["string timer", /set(Timeout|Interval)\s*\(\s*["'`]/],
	["innerHTML", /\binnerHTML\b/],
	["outerHTML", /\bouterHTML\b/],
	["insertAdjacentHTML", /\binsertAdjacentHTML\b/],
	["document.write", /\bdocument\s*\.\s*write/],
	["DOMParser", /\bDOMParser\b|\bcreateContextualFragment\b|\bsrcdoc\b/],
	[
		"network call",
		/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|\bsendBeacon\b/,
	],
	["dynamic import", /\bimport\s*\(/],
	["external script", /<script[^>]*\bsrc\b/i],
	[
		"external or embedded resource",
		/<(link|img|iframe|object|embed|video|audio|source|base)\b/i,
	],
	["css import or url", /@import|url\s*\(/i],
	["inline event handler attribute", /<[^>]+\son[a-z]+\s*=/i],
	["link or form control", /<(a|form|button|input|select|textarea)\b/i],
	[
		"href or src written from script",
		/\.(href|src|action)\s*=|setAttribute\(\s*["'](href|src|action|on)/i,
	],
	[
		"tool call",
		/tools\/call|callTool|sendFollowUpMessage|ui\/message|ui\/open-link|openExternal/,
	],
	[
		"storage or cookies",
		/\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|document\s*\.\s*cookie/,
	],
];

describe("MCP Apps views are self-contained, read-only and sink-free", () => {
	test("every generated template has exactly one source file, and no file is unbound", () => {
		const bound = MCP_UI_RESOURCES.map(
			(view) => `${view.template}.html`,
		).sort();
		expect(readdirSync(dir).sort()).toEqual(bound);
		for (const file of bound) expect(existsSync(`${dir}/${file}`)).toBe(true);
	});

	test.each(
		MCP_UI_RESOURCES.map((view) => view.template),
	)("%s contains no forbidden construct", (template) => {
		const source = readFileSync(`${dir}/${template}.html`, "utf8");
		expect(source.toLowerCase().startsWith("<!doctype html>")).toBe(true);
		for (const [name, pattern] of forbidden)
			expect(pattern.test(source), `${template}.html: ${name}`).toBe(false);
		// Result data is written as text only.
		expect(source).toContain("textContent");
		// One inline script, one inline style, nothing else executable.
		expect(source.match(/<script\b/gi)?.length).toBe(1);
		expect(source.match(/<style\b/gi)?.length).toBe(1);
	});
});

// WCAG 2.x contrast of every text/background pair the view uses, in both themes, computed from
// the view's own custom properties. Change a token to a failing value and this fails.
type Rgb = [number, number, number];
const blocks = (source: string) =>
	[...source.matchAll(/([^{}]*)\{([^{}]*--bg:[^{}]*)\}/g)].map(
		([, selector = "", body = ""]) => ({
			selector: selector.trim(),
			tokens: Object.fromEntries(
				[...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map(
					([, name, hex]) => [name, hex],
				),
			) as Record<string, string>,
		}),
	);
const luminance = (hex: string) => {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	}) as Rgb;
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
	const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
};
const PAIRS: Array<[string, string]> = [
	["text", "bg"],
	["text", "card"],
	["muted", "bg"],
	["muted", "card"],
	["decision-text", "decision-bg"],
	["unverified-text", "unverified-bg"],
	["verified-text", "verified-bg"],
	["confirmed-text", "confirmed-bg"],
	["rejected-text", "rejected-bg"],
];

describe("MCP Apps views: contrast and theme parity", () => {
	test.each(
		MCP_UI_RESOURCES.map((view) => view.template),
	)("%s meets 4.5:1 for every text pair in light and dark", (template) => {
		const source = readFileSync(`${dir}/${template}.html`, "utf8");
		const found = blocks(
			source.slice(source.indexOf("<style>") + 7, source.indexOf("</style>")),
		);
		// Light default, dark by OS preference, dark by host signal.
		expect(found.map((block) => block.selector)).toEqual([
			":root",
			':root:not([data-theme="light"])',
			':root[data-theme="dark"]',
		]);
		const [light, osDark, hostDark] = found.map((block) => block.tokens);
		// The OS-preference palette and the host-signal palette must not drift apart.
		expect(osDark).toEqual(hostDark);
		expect(Object.keys(light ?? {}).sort()).toEqual(
			Object.keys(hostDark ?? {}).sort(),
		);
		for (const [theme, tokens] of [
			["light", light],
			["dark", hostDark],
		] as const)
			for (const [text, background] of PAIRS) {
				const ratio = contrast(
					tokens?.[text] ?? "",
					tokens?.[background] ?? "",
				);
				expect(
					ratio,
					`${template} ${theme}: ${text} on ${background} = ${ratio.toFixed(2)}`,
				).toBeGreaterThanOrEqual(4.5);
			}
	});
});
