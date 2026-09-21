// Real-browser acceptance for the home route: the copy button really writes the MCP URL, the live
// region really updates, a browser without `navigator.clipboard` gets a message instead of an
// exception, and the keyboard focus ring is visible in both themes. Same opt-in rules as
// workshop.browser.test.ts: SKIPS, loudly, when Chromium is not installed. No backend is
// configured on purpose, so the repositories panel shows its "not configured" state.
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
import {
	COPY_STATUS,
	MCP_SERVER_URL,
} from "../../src/components/catalog/connect-agent";

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

describe.skipIf(!available)("/ (home) in a real browser", () => {
	let browser: Browser;
	let server: ViteDevServer;
	let origin: string;

	beforeAll(async () => {
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
		browser = await chromium.launch({ headless: true });
		// A cold Vite cache discovers dependencies on the first visit and reloads the page, which
		// surfaces as a failed dynamic import. That is the dev server warming up, not the page, so
		// one unobserved visit absorbs it before any test listens for page errors.
		const warmup = await browser.newPage();
		try {
			await warmup.goto(`${origin}/`, { waitUntil: "networkidle" });
			await warmup.reload({ waitUntil: "networkidle" });
		} finally {
			await warmup.close();
		}
	}, 120_000);

	afterAll(async () => {
		await browser?.close();
		await server?.close();
	});

	async function openHome(context: BrowserContext): Promise<{
		page: Page;
		errors: string[];
	}> {
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(String(error)));
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.goto(`${origin}/`);
		await page.getByRole("heading", { name: "Connect your agent" }).waitFor();
		return { page, errors };
	}

	// The server-rendered button exists before hydration attaches its handler, so click until the
	// live region answers rather than assuming the first click landed.
	async function copyAndReadStatus(page: Page): Promise<string> {
		const button = page.getByRole("button", { name: "Copy MCP server URL" });
		const status = page.locator(".connect-agent output[aria-live='polite']");
		await expect
			.poll(
				async () => {
					await button.click();
					// The handler clears the status and fills it after the async clipboard write.
					// Give that write time to settle before clicking again, or a slow machine
					// clears the status on every poll and never sees the answer.
					await status
						.filter({ hasText: /\S/ })
						.waitFor({ timeout: 2_000 })
						.catch(() => {});
					return (await status.textContent()) ?? "";
				},
				{ timeout: 20_000 },
			)
			.not.toBe("");
		return (await status.textContent()) ?? "";
	}

	it("copies the canonical URL and announces it", async () => {
		const context = await browser.newContext({
			permissions: ["clipboard-read", "clipboard-write"],
		});
		try {
			const { page, errors } = await openHome(context);
			expect(
				await page.getByText(MCP_SERVER_URL, { exact: true }).count(),
			).toBe(1);
			expect(await copyAndReadStatus(page)).toBe(COPY_STATUS.copied);
			expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
				MCP_SERVER_URL,
			);
			expect(errors).toEqual([]);
		} finally {
			await context.close();
		}
	}, 30_000);

	it("says so, without an exception, when navigator.clipboard is missing", async () => {
		const context = await browser.newContext();
		await context.addInitScript(() => {
			Object.defineProperty(Navigator.prototype, "clipboard", {
				configurable: true,
				get: () => undefined,
			});
		});
		try {
			const { page, errors } = await openHome(context);
			expect(await page.evaluate(() => navigator.clipboard)).toBeUndefined();
			expect(await copyAndReadStatus(page)).toBe(COPY_STATUS.unavailable);
			expect(errors).toEqual([]);
		} finally {
			await context.close();
		}
	}, 30_000);

	it("orders the page: connect section, repositories panel, investigation ID form", async () => {
		const context = await browser.newContext();
		try {
			const { page } = await openHome(context);
			const order = await page.evaluate(() => {
				const connect = document.querySelector(".connect-agent");
				const repositories = document.querySelector(".home-repositories");
				const access = document.querySelector(".home-secondary form");
				if (!connect || !repositories || !access) {
					throw new Error("The home route is missing a section");
				}
				const follows = (a: Element, b: Element) =>
					(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !==
					0;
				return [follows(connect, repositories), follows(repositories, access)];
			});
			expect(order).toEqual([true, true]);
		} finally {
			await context.close();
		}
	}, 30_000);

	it.each([
		"light",
		"dark",
	] as const)("shows a solid keyboard focus ring on the copy button in the %s theme", async (theme) => {
		const context = await browser.newContext();
		try {
			const { page } = await openHome(context);
			await page.evaluate(
				(dark) => document.documentElement.classList.toggle("dark", dark),
				theme === "dark",
			);
			const button = page.getByRole("button", { name: "Copy MCP server URL" });
			const focused = () =>
				button.evaluate((element) => document.activeElement === element);
			for (let presses = 0; presses < 30 && !(await focused()); presses++) {
				await page.keyboard.press("Tab");
			}
			const ring = await button.evaluate((element) => {
				const style = getComputedStyle(element);
				const probe = document.createElement("span");
				probe.style.color = "var(--ring)";
				document.body.append(probe);
				const expectedColour = getComputedStyle(probe).color;
				probe.remove();
				return {
					active: document.activeElement === element,
					focusVisible: element.matches(":focus-visible"),
					colour: style.outlineColor,
					expectedColour,
					style: style.outlineStyle,
					width: style.outlineWidth,
				};
			});
			expect(ring).toMatchObject({
				active: true,
				focusVisible: true,
				style: "solid",
			});
			// CI Chromium reports 3px where a desktop reports 2px; the rule is "clearly visible".
			expect(Number.parseFloat(ring.width)).toBeGreaterThanOrEqual(2);
			expect(ring.colour).toBe(ring.expectedColour);
		} finally {
			await context.close();
		}
	}, 30_000);
});
