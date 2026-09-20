import type { AddressInfo } from "node:net";
import react from "@vitejs/plugin-react";
import { type Browser, chromium } from "playwright-chromium";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, test } from "vitest";

let server: ViteDevServer;
let browser: Browser;
let origin: string;

beforeAll(async () => {
	server = await createServer({
		configFile: false,
		plugins: [
			react(),
			{
				name: "category-component-harness",
				configureServer(devServer) {
					devServer.middlewares.use(
						"/category-test",
						async (_request, response) => {
							response.setHeader("Content-Type", "text/html");
							response.end(
								await devServer.transformIndexHtml(
									"/category-test",
									'<!doctype html><html><body><div id="root"></div><script type="module" src="/tests/render/fixtures/decision-category.tsx"></script></body></html>',
								),
							);
						},
					);
				},
			},
		],
		logLevel: "silent",
		server: { host: "127.0.0.1", port: 0 },
	});
	await server.listen();
	const address = server.httpServer?.address() as AddressInfo | null;
	if (!address) throw new Error("Missing component test server");
	origin = `http://127.0.0.1:${address.port}`;
	browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
	await browser?.close();
	await server?.close();
});

test("category survives typing, action changes and editor remount; omission and keyboard order are real", async () => {
	const page = await browser.newPage();
	page.setDefaultTimeout(5000);
	const external: string[] = [];
	page.on("request", (request) => {
		if (!request.url().startsWith(origin)) external.push(request.url());
	});
	try {
		await page.goto(`${origin}/category-test`);
		const action = page.getByLabel("Decision action", { exact: true });
		const category = page.getByLabel("Category (optional)", { exact: true });
		const statement = page.getByLabel("Your direction", { exact: true });
		await action.waitFor();
		await action.focus();
		await page.keyboard.press("Tab");
		expect(
			await category.evaluate((element) => element === document.activeElement),
		).toBe(true);
		await page.keyboard.press("Tab");
		expect(
			await statement.evaluate((element) => element === document.activeElement),
		).toBe(true);
		await page.keyboard.press("Tab");
		expect(
			await page
				.getByRole("button", { name: "Save decision" })
				.evaluate((element) => element === document.activeElement),
		).toBe(true);

		await category.selectOption("security");
		await statement.fill("Do not log credentials.");
		await action.selectOption("correction");
		await page.getByRole("button", { name: "Toggle editor" }).click();
		await page.getByRole("button", { name: "Toggle editor" }).click();
		expect(await category.inputValue()).toBe("security");
		expect(await statement.inputValue()).toBe("Do not log credentials.");
		await page.getByRole("button", { name: "Save decision" }).click();
		const submitted = page.getByLabel("Submitted request");
		expect(JSON.parse((await submitted.textContent()) ?? "{}")).toMatchObject({
			kind: "correction",
			category: "security",
			statement: "Do not log credentials.",
		});
		await category.selectOption("architecture");
		await page.getByRole("button", { name: "Save decision" }).click();
		expect(JSON.parse((await submitted.textContent()) ?? "{}").category).toBe(
			"architecture",
		);
		await category.selectOption("");
		await page.getByRole("button", { name: "Save decision" }).click();
		expect(
			JSON.parse((await submitted.textContent()) ?? "{}"),
		).not.toHaveProperty("category");
		expect(external).toEqual([]);
	} finally {
		await page.close();
	}
});
