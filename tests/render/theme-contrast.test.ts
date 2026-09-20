import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import {
	type Browser,
	type BrowserContext,
	chromium,
	type Page,
} from "playwright-chromium";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// WCAG 2.x contrast for the colour pairs the workshop, catalog and home route really use,
// computed from src/styles/theme.css. Change a token to a failing value and this fails.
// Print the table: CONTRAST_TABLE=1 bunx vitest run tests/render/theme-contrast.test.ts

const read = (path: string) =>
	readFileSync(new URL(`../../src/styles/${path}`, import.meta.url), "utf8");

type Rgb = [number, number, number];
type Tokens = Record<string, string>;

function tokensOf(css: string, selector: ":root" | ".dark"): Tokens {
	const start = css.indexOf(`${selector} {`);
	const block = css.slice(start, css.indexOf("\n}", start));
	const tokens: Tokens = {};
	for (const [, name, hex] of block.matchAll(
		/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g,
	)) {
		tokens[name] = hex;
	}
	return tokens;
}

function rgb(tokens: Tokens, name: string): Rgb {
	const hex = tokens[name];
	if (!hex) {
		throw new Error(`theme.css has no hex value for --${name}`);
	}
	return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

// "input/30 on card" is --input at 30% alpha composited over --card. Layers read top to bottom.
function resolve(tokens: Tokens, spec: string): Rgb {
	const [top, ...below] = spec.split(" on ");
	const [name, alpha] = top.split("/");
	const colour = rgb(tokens, name);
	if (alpha === undefined) {
		return colour;
	}
	const backdrop = resolve(tokens, below.join(" on "));
	const a = Number(alpha) / 100;
	return colour.map((c, i) => a * c + (1 - a) * backdrop[i]) as Rgb;
}

function luminance(colour: Rgb): number {
	const [r, g, b] = colour.map((value) => {
		const c = value / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

const TEXT = 4.5; // normal text
const LARGE = 3; // >= 24px, or >= 18.66px bold
const NON_TEXT = 3; // control boundaries, focus indicators, meaningful icons

// "fg | bg" per theme; dark defaults to the light spec. They differ where a shadcn variant paints
// a different fill per theme (`dark:bg-input/30`). "(card)" rows exist because
// HandoffPreview puts an outline Button on a card and the decision preview a ghost Button.
const PAIRS: [name: string, min: number, light: string, dark?: string][] = [
	["body text", TEXT, "foreground | background"],
	["text on a card", TEXT, "foreground | card"],
	["card-foreground token", TEXT, "card-foreground | card"],
	["primary Button, ::selection", TEXT, "primary-foreground | primary"],
	[
		"primary Button hover",
		TEXT,
		"primary-foreground | primary/90 on background",
	],
	[
		"outline Button (page)",
		TEXT,
		"foreground | background",
		"foreground | input/30 on background",
	],
	[
		"outline Button (card)",
		TEXT,
		"foreground | background",
		"foreground | input/30 on card",
	],
	[
		"outline Button hover (page)",
		TEXT,
		"accent-foreground | accent",
		"accent-foreground | input/50 on background",
	],
	[
		"outline Button hover (card)",
		TEXT,
		"accent-foreground | accent",
		"accent-foreground | input/50 on card",
	],
	[
		"ghost Button hover (page)",
		TEXT,
		"accent-foreground | accent",
		"accent-foreground | accent/50 on background",
	],
	[
		"ghost Button hover (card)",
		TEXT,
		"accent-foreground | accent",
		"accent-foreground | accent/50 on card",
	],
	[
		"Textarea text",
		TEXT,
		"foreground | background",
		"foreground | input/30 on background",
	],
	[
		"Textarea placeholder",
		TEXT,
		"muted-foreground | background",
		"muted-foreground | input/30 on background",
	],
	["secondary Button (unused)", TEXT, "secondary-foreground | secondary"],
	[
		"secondary Button hover (unused)",
		TEXT,
		"secondary-foreground | secondary/80 on background",
	],
	["muted surface (unused)", TEXT, "muted-foreground | muted"],
	["pink headline accent, brand dot", LARGE, "primary-text | background"],
	[".note-number on the intro card", LARGE, "primary-text | card"],
	["pink icons on the page", NON_TEXT, "primary-text | background"],
	["field and outline Button border (page)", NON_TEXT, "input | background"],
	["outline Button border (card)", NON_TEXT, "input | card"],
	["invalid field border", NON_TEXT, "destructive | background"],
	["focus ring (page)", NON_TEXT, "ring | background"],
	["focus ring (card)", NON_TEXT, "ring | card"],
];

const theme = read("theme.css");
const themes = {
	light: tokensOf(theme, ":root"),
	dark: tokensOf(theme, ".dark"),
};
const renderedThemes = ["light", "dark"] as const;
type RenderedTheme = (typeof renderedThemes)[number];

function ratio(tokens: Tokens, pair: string): number {
	const [fg, bg] = pair.split(" | ");
	return contrast(resolve(tokens, fg), resolve(tokens, bg));
}

if (process.env.CONTRAST_TABLE) {
	console.table(
		PAIRS.map(([pair, min, light, dark = light]) => ({
			pair,
			light: ratio(themes.light, light).toFixed(2),
			dark: ratio(themes.dark, dark).toFixed(2),
			min,
		})),
	);
}

describe("theme contrast (WCAG 2.x, computed from src/styles/theme.css)", () => {
	it("sanity: black on white is 21:1 and alpha composites over its backdrop", () => {
		const bw = { a: "#000000", b: "#ffffff" };
		expect(ratio(bw, "a | b")).toBeCloseTo(21, 5);
		expect(resolve(bw, "a/50 on b").map(Math.round)).toEqual([128, 128, 128]);
	});

	for (const [name, min, light, dark = light] of PAIRS) {
		it(`${name}: light and dark >= ${min}:1`, () => {
			expect(
				ratio(themes.light, light),
				`light: ${light}`,
			).toBeGreaterThanOrEqual(min);
			expect(ratio(themes.dark, dark), `dark: ${dark}`).toBeGreaterThanOrEqual(
				min,
			);
		});
	}

	// Two rows above are only true because of a rule outside theme.css. Pin those rules.
	it("the CSS still routes those pairs through the tokens measured here", () => {
		// shadcn's outline Button uses --border in light (2.93:1); globals.css moves it to --input.
		expect(read("globals.css")).toMatch(
			/\[data-slot="button"\]\[data-variant="outline"\]\s*\{\s*border-color:\s*var\(--input\)/,
		);
		// Dark --primary is 2.86:1 on a card. Pink text and icons use --primary-text instead.
		expect(read("workshop.css")).not.toMatch(/[^-]color:\s*var\(--primary\)/);
	});
});

describe("/workshop rendered theme coverage", () => {
	let browser: Browser;
	let server: ViteDevServer;
	let workshopUrl: string;

	beforeAll(async () => {
		server = await createServer({
			define: {
				"import.meta.env.VITE_CONVEX_URL": JSON.stringify(
					"http://127.0.0.1:3210",
				),
			},
			logLevel: "silent",
			server: { host: "127.0.0.1", port: 0 },
		});
		await server.listen();
		const address = server.httpServer?.address() as AddressInfo | null;
		if (!address) {
			throw new Error("Vite did not expose a listening address");
		}
		workshopUrl = `http://127.0.0.1:${address.port}/workshop`;
		browser = await chromium.launch({ headless: true });
	}, 30_000);

	afterAll(async () => {
		await browser?.close();
		await server?.close();
	});

	async function openWorkshop(
		context: BrowserContext,
		renderedTheme: RenderedTheme,
	): Promise<Page> {
		const page = await context.newPage();
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.goto(workshopUrl);
		await page.getByRole("heading", { name: /Find the connection/ }).waitFor();

		if (renderedTheme === "dark") {
			const themeToggle = page.locator(".header-actions button");
			await expect
				.poll(
					async () => {
						const pressed = await themeToggle.getAttribute("aria-pressed");
						if (pressed !== "true") {
							await themeToggle.click();
						}
						return themeToggle.getAttribute("aria-pressed");
					},
					{ timeout: 5_000 },
				)
				.toBe("true");
		}
		await expect
			.poll(() =>
				page
					.locator("html")
					.evaluate((element) => element.classList.contains("dark")),
			)
			.toBe(renderedTheme === "dark");
		return page;
	}

	it.each(
		renderedThemes,
	)("renders visible focus and hover states in the %s theme", async (renderedTheme) => {
		const context = await browser.newContext();
		try {
			const page = await openWorkshop(context, renderedTheme);
			const preview = page.getByRole("button", { name: /Preview decision/ });
			await page.getByLabel("Your direction").focus();
			await page.keyboard.press("Tab");
			const focus = () =>
				preview.evaluate((element) => {
					const style = getComputedStyle(element);
					const colourProbe = document.createElement("span");
					colourProbe.style.color = "var(--ring)";
					document.body.append(colourProbe);
					const expectedColour = getComputedStyle(colourProbe).color;
					colourProbe.remove();
					return {
						active: document.activeElement === element,
						colour: style.outlineColor,
						expectedColour,
						offset: style.outlineOffset,
						style: style.outlineStyle,
						width: style.outlineWidth,
					};
				});
			await expect.poll(focus).toMatchObject({
				active: true,
				offset: "4px",
				style: "solid",
				width: "2px",
			});
			const settledFocus = await focus();
			expect(settledFocus.colour).toBe(settledFocus.expectedColour);

			const beforeHover = await preview.evaluate(
				(element) => getComputedStyle(element).backgroundColor,
			);
			await preview.hover();
			await expect
				.poll(() =>
					preview.evaluate(
						(element) => getComputedStyle(element).backgroundColor,
					),
				)
				.not.toBe(beforeHover);
		} finally {
			await context.close();
		}
	});

	it.each(
		renderedThemes,
	)("loads self-hosted fonts and preserves fallback rendering in the %s theme", async (renderedTheme) => {
		const context = await browser.newContext();
		try {
			const page = await openWorkshop(context, renderedTheme);
			await page.evaluate(() => document.fonts.ready);
			const loaded = await page.evaluate(() => {
				const monoElement = document.querySelector<HTMLElement>(".source-path");
				if (!monoElement) {
					throw new Error("The workshop did not render a source path");
				}
				return {
					mono: document.fonts.check('11px "Space Mono"'),
					monoFamily: getComputedStyle(monoElement).fontFamily,
					sans: document.fonts.check('16px "Outfit Variable"'),
					sansFamily: getComputedStyle(document.body).fontFamily,
				};
			});
			expect(loaded.sans).toBe(true);
			expect(loaded.mono).toBe(true);
			expect(loaded.sansFamily).toContain("Outfit Variable");
			expect(loaded.sansFamily).toContain("sans-serif");
			expect(loaded.monoFamily).toContain("Space Mono");
			expect(loaded.monoFamily).toContain("monospace");
		} finally {
			await context.close();
		}

		const fallbackContext = await browser.newContext();
		await fallbackContext.route(/\.(?:woff2?|ttf)(?:\?.*)?$/, (route) =>
			route.abort(),
		);
		try {
			const fallbackPage = await openWorkshop(fallbackContext, renderedTheme);
			await fallbackPage.evaluate(() => document.fonts.ready);
			const fallback = await fallbackPage.evaluate(() => ({
				bodyWidth: document.body.getBoundingClientRect().width,
				errors: [...document.fonts].filter((font) => font.status === "error")
					.length,
				headingVisible:
					document.querySelector("h1")?.getBoundingClientRect().height !== 0,
				sansFamily: getComputedStyle(document.body).fontFamily,
			}));
			expect(fallback.errors).toBeGreaterThan(0);
			expect(fallback.headingVisible).toBe(true);
			expect(fallback.bodyWidth).toBeGreaterThan(0);
			expect(fallback.sansFamily).toContain("sans-serif");
		} finally {
			await fallbackContext.close();
		}
	}, 30_000);

	it.each(
		renderedThemes,
	)("uses the mobile workshop layout without horizontal overflow in the %s theme", async (renderedTheme) => {
		const context = await browser.newContext({
			viewport: { width: 390, height: 844 },
		});
		try {
			const page = await openWorkshop(context, renderedTheme);
			const mobile = await page.evaluate(() => {
				const style = (selector: string) => {
					const element = document.querySelector<HTMLElement>(selector);
					if (!element) {
						throw new Error(`The workshop did not render ${selector}`);
					}
					return getComputedStyle(element);
				};
				const visibleCards = [
					...document.querySelectorAll<HTMLElement>(".source-card"),
				];
				return {
					cardsFit: visibleCards.every((card) => {
						const box = card.getBoundingClientRect();
						return box.left >= 0 && box.right <= window.innerWidth;
					}),
					controlFontSize: style(".form-field textarea").fontSize,
					evidenceColumns:
						style(".evidence-pair").gridTemplateColumns.split(" ").length,
					introColumns:
						style(".workshop-intro").gridTemplateColumns.split(" ").length,
					introNote: style(".intro-note").display,
					noHorizontalOverflow:
						document.documentElement.scrollWidth <=
						document.documentElement.clientWidth,
					toolbarDirection: style(".workshop-toolbar").flexDirection,
				};
			});
			expect(mobile).toEqual({
				cardsFit: true,
				controlFontSize: "16px",
				evidenceColumns: 1,
				introColumns: 1,
				introNote: "none",
				noHorizontalOverflow: true,
				toolbarDirection: "column",
			});
		} finally {
			await context.close();
		}
	});
});
