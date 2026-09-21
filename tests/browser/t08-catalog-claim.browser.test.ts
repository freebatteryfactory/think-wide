import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
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
		resolve: {
			alias: [
				{
					find: /^.*\/integrations\/convex\/provider$/,
					replacement: fileURLToPath(
						new URL(
							"../render/fixtures/catalog-view-backend.tsx",
							import.meta.url,
						),
					),
				},
				{
					find: /^convex\/react$/,
					replacement: fileURLToPath(
						new URL(
							"../render/fixtures/catalog-view-client.tsx",
							import.meta.url,
						),
					),
				},
			],
		},
		define: {
			"import.meta.env.VITE_THINK_WIDE_IDENTITY": JSON.stringify("workos"),
		},
		plugins: [
			react(),
			{
				name: "catalog-component-harness",
				configureServer(devServer) {
					devServer.middlewares.use(
						"/catalog-test",
						async (_request, response) => {
							response.setHeader("Content-Type", "text/html");
							response.end(
								await devServer.transformIndexHtml(
									"/catalog-test",
									'<!doctype html><html><body><div id="root"></div><script type="module" src="/tests/render/fixtures/catalog-claim.tsx"></script></body></html>',
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

test("StrictMode waits for one claim, reattaches completion and preserves the session key", async () => {
	const page = await browser.newPage();
	page.setDefaultTimeout(5000);
	page.on("pageerror", (error) => console.error(error.message));
	try {
		await page.goto(`${origin}/catalog-test`);
		expect(await page.getByTestId("portfolio").count()).toBe(0);
		await page
			.getByRole("button", { name: "Authenticate", exact: true })
			.click();
		await page.getByText("Preparing your demo repositories…").waitFor();
		await page.getByRole("button", { name: "Rerender", exact: true }).click();
		const first = JSON.parse(await page.getByTestId("calls").innerText());
		expect(first.A).toHaveLength(1);
		await page.getByRole("button", { name: "Resolve A", exact: true }).click();
		await page.getByTestId("portfolio").waitFor();
		await page
			.getByRole("button", { name: "Toggle portfolio", exact: true })
			.click();
		await page
			.getByRole("button", { name: "Toggle portfolio", exact: true })
			.click();
		await page.getByTestId("portfolio").waitFor();
		await page.getByRole("button", { name: "Rerender", exact: true }).click();
		expect(JSON.parse(await page.getByTestId("calls").innerText()).A).toEqual(
			first.A,
		);
	} finally {
		await page.close();
	}
});
test("failed claims never loop; explicit retry keeps the key and manual access stays available", async () => {
	const page = await browser.newPage();
	page.setDefaultTimeout(5000);
	page.on("pageerror", (error) => console.error(error.message));
	try {
		await page.goto(`${origin}/catalog-test`);
		await page
			.getByRole("button", { name: "Authenticate", exact: true })
			.click();
		await page.getByText("Preparing your demo repositories…").waitFor();
		await page.getByRole("button", { name: "Reject A", exact: true }).click();
		await page.getByRole("alert").waitFor();
		await page.getByRole("button", { name: "Rerender", exact: true }).click();
		expect(
			JSON.parse(await page.getByTestId("calls").innerText()).A,
		).toHaveLength(1);
		await page
			.getByRole("button", { name: "Retry demo access", exact: true })
			.click();
		await page.getByText("Preparing your demo repositories…").waitFor();
		await page.getByRole("button", { name: "Rerender", exact: true }).click();
		const keys = JSON.parse(await page.getByTestId("calls").innerText()).A;
		expect(keys).toHaveLength(2);
		expect(keys[0]).toBe(keys[1]);
		await page.getByRole("button", { name: "Reject A", exact: true }).click();
		await page
			.getByRole("button", {
				name: "Continue to my existing repositories",
				exact: true,
			})
			.click();
		await page.getByTestId("portfolio").waitFor();
	} finally {
		await page.close();
	}
});
test("late A completion cannot reveal the portfolio after switching to B", async () => {
	const page = await browser.newPage();
	page.setDefaultTimeout(5000);
	page.on("pageerror", (error) => console.error(error.message));
	try {
		await page.goto(`${origin}/catalog-test`);
		await page
			.getByRole("button", { name: "Authenticate", exact: true })
			.click();
		await page.getByText("Preparing your demo repositories…").waitFor();
		await page
			.getByRole("button", { name: "Switch to B", exact: true })
			.click();
		await page.getByRole("button", { name: "Resolve A", exact: true }).click();
		await page.getByRole("button", { name: "Rerender", exact: true }).click();
		expect(await page.getByTestId("portfolio").count()).toBe(0);
		await page.getByRole("button", { name: "Resolve B", exact: true }).click();
		await page.getByText("Portfolio B", { exact: true }).waitFor();
		await page.getByRole("button", { name: "Rerender", exact: true }).click();
		const calls = JSON.parse(await page.getByTestId("calls").innerText());
		expect(calls.A).toHaveLength(1);
		expect(calls.B).toHaveLength(1);
		expect(calls.A[0]).not.toBe(calls.B[0]);
	} finally {
		await page.close();
	}
});

test("actual portfolio starts queries after claim and keeps drafts during authenticated refresh", async () => {
	const page = await browser.newPage();
	page.setDefaultTimeout(5000);
	page.on("pageerror", (error) => console.error(error.message));
	try {
		await page.goto(`${origin}/catalog-test?portfolio`);
		expect(await page.getByLabel("Investigation question").count()).toBe(0);
		await page
			.getByRole("button", { name: "Authenticate", exact: true })
			.click();
		const question = page.getByLabel("Investigation question");
		await question.waitFor();
		await question.fill("Keep this private question");
		await page.getByRole("checkbox").check();
		await page
			.getByRole("button", { name: "Toggle refresh", exact: true })
			.click();
		expect(await question.inputValue()).toBe("Keep this private question");
		expect(await page.getByRole("checkbox").isChecked()).toBe(true);
		await page.getByRole("button", { name: "Rerender", exact: true }).click();
		const events = JSON.parse(await page.getByTestId("events").innerText());
		expect(events[0]).toBe("claim");
		expect(events).toContain("query");
	} finally {
		await page.close();
	}
});
