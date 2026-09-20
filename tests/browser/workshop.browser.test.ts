// Real-browser acceptance for the workshop: what nobody could verify by reading code.
// Modular on purpose: it lives outside the default vitest include, has its own config and script
// (`bun run test:browser`), and SKIPS with a stated reason when no Chromium is installed, so the
// main gate (`bun run verify`) never depends on a browser download.
//   one-time:  bun run browser:install
//   run:       bun run test:browser
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import {
	type Browser,
	type BrowserContext,
	chromium,
	type Page,
} from "playwright-chromium";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const renderedThemes = ["light", "dark"] as const;
type RenderedTheme = (typeof renderedThemes)[number];

function chromiumAvailable(): boolean {
	try {
		return existsSync(chromium.executablePath());
	} catch {
		return false;
	}
}
const available = chromiumAvailable();
if (!available) {
	console.warn(
		"browser acceptance SKIPPED: no Chromium for playwright-chromium (run `bun run browser:install`). This is NOT a pass.",
	);
}

describe.skipIf(!available)("/workshop in a real browser", () => {
	let browser: Browser;
	let server: ViteDevServer;
	let origin: string;
	let workshopUrl: string;

	beforeAll(async () => {
		// No backend URL on purpose: the workshop must render without one.
		server = await createServer({
			logLevel: "silent",
			server: { host: "127.0.0.1", port: 0 },
		});
		await server.listen();
		const address = server.httpServer?.address() as AddressInfo | null;
		if (!address) {
			throw new Error("Vite did not expose a listening address");
		}
		origin = `http://127.0.0.1:${address.port}`;
		workshopUrl = `${origin}/workshop`;
		browser = await chromium.launch({ headless: true });
	}, 60_000);

	afterAll(async () => {
		await browser?.close();
		await server?.close();
	});

	it("hydrates without console errors and makes no request off its own origin", async () => {
		const context = await browser.newContext();
		const problems: string[] = [];
		const external: string[] = [];
		try {
			const page = await context.newPage();
			page.on("console", (message) => {
				if (message.type() === "error") {
					problems.push(message.text());
				}
			});
			page.on("pageerror", (error) => problems.push(String(error)));
			page.on("request", (request) => {
				const url = request.url();
				if (!url.startsWith(origin) && !url.startsWith("data:")) {
					external.push(url);
				}
			});
			await page.goto(workshopUrl);
			await page
				.getByRole("heading", { name: /Find the connection/ })
				.waitFor();
			await page.evaluate(() => document.fonts.ready);
			// The missing-backend notice is expected and logged by design; anything else is a defect.
			const unexpected = problems.filter(
				(text) => !text.includes("VITE_CONVEX_URL was not set"),
			);
			expect(unexpected).toEqual([]);
			expect(external).toEqual([]);
		} finally {
			await context.close();
		}
	}, 30_000);

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
