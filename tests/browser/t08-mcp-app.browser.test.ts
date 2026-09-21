// Real-browser acceptance for the read-only investigation view served to MCP hosts.
// The view is loaded exactly as the server serves it, inside a sandboxed iframe, under the
// restrictive default CSP that SEP-1865 requires of a host when a view declares no origins.
// A minimal host speaks the MCP Apps postMessage bridge; a second test drives the ChatGPT
// compatibility surface (window.openai). Opt-in like the rest of tests/browser:
//   bun run test:browser     (skips loudly, and is NOT a pass, without Chromium)
// This proves the view in Chromium. It does not prove rendering inside ChatGPT or Claude.ai.
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { type Browser, chromium, type Page } from "playwright-chromium";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { MCP_UI_RESOURCES } from "../../generated/mcp-tools";
import type { Investigation } from "../../generated/types";
import * as validators from "../../generated/validators.js";

const DEFAULT_CSP =
	"default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; connect-src 'none'";
const view = MCP_UI_RESOURCES.find((item) => item.template === "investigation");
if (!view) throw new Error("No generated investigation view");
const html = readFileSync(`src/server/mcp/apps/${view.template}.html`, "utf8");

const HOSTILE_CLAIM = "<img src=x onerror=alert(1)>";
const HOSTILE_SCRIPT = "</script><script>window.__pwned=1</script>";
const LONG = "a".repeat(600);
const commit = "0123456789abcdef0123456789abcdef01234567";
const digest = `${"9f".repeat(31)}ab`.padEnd(64, "c");
const ref = {
	repositoryId: "repo_payments",
	snapshotId: "snap_payments_1",
	commit,
	hashAlgorithm: "sha1",
	blobId: "b".repeat(40),
	entryId: "entry_77",
	displayPath: `javascript:alert(1)/${LONG}.ts`,
	byteRange: { start: 10, end: 42 },
	lineRange: { start: 3, end: 5 },
	digest,
} as const;
const investigation: Investigation = {
	investigationId: "inv_1",
	question: `How do we retry webhooks? ${HOSTILE_SCRIPT} ${LONG}`,
	snapshotIds: ["snap_payments_1", "snap_orders_2"],
	revision: 3,
	status: "awaiting_human",
	createdAt: 1_760_000_000_000,
	currentRunId: null,
	latestHandoffId: null,
	acceptedFindings: [
		{
			findingId: "finding_unverified",
			evidenceClass: "model_hypothesis",
			summary: HOSTILE_CLAIM,
			refs: [ref],
			extractor: { kind: "model", modelId: "host-model" },
			unknowns: [
				"Is the retry budget shared across tenants?",
				'<svg onload="window.__pwned=1">',
			],
			verification: "unverified",
			observedAt: 1_760_000_100_000,
		},
		{
			findingId: "finding_confirmed",
			evidenceClass: "observed_literal",
			summary: "Retry uses exponential backoff",
			refs: [ref],
			verification: "human_confirmed",
			observedAt: 1_760_000_200_000,
		},
	],
	decisions: [
		{
			decisionId: "decision_1",
			investigationId: "inv_1",
			kind: "constraint",
			category: "security",
			statement: `Never log the signing secret. <b onmouseover="window.__pwned=1">x</b>`,
			madeAtRevision: 2,
			resultingRevision: 3,
			createdAt: 1_760_000_300_000,
		},
	],
};

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
		"MCP Apps view browser acceptance SKIPPED: no Chromium for playwright-chromium (run `bun run browser:install`). This is NOT a pass.",
	);
}

// A minimal MCP Apps host: answers ui/initialize, waits for ui/notifications/initialized, then
// sends tool-input and tool-result. It sends nothing earlier, as the specification requires.
const HOST_PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}iframe{border:0;width:100%;height:2000px;display:block}</style></head><body>
<iframe id="view" sandbox="allow-scripts" src="/view"></iframe>
<script>
	window.__log = [];
	const frame = document.getElementById("view");
	window.__send = (message) => frame.contentWindow.postMessage(message, "*");
	window.addEventListener("message", (event) => {
		if (event.source !== frame.contentWindow) return;
		const message = event.data;
		window.__log.push(message);
		if (message.method === "ui/initialize") {
			window.__send({ jsonrpc: "2.0", id: message.id, result: {
				protocolVersion: "2026-01-26",
				hostInfo: { name: "qa-host", version: "1" },
				hostCapabilities: {},
				hostContext: window.__theme ? { theme: window.__theme } : {},
			} });
		}
		if (message.method === "ui/notifications/initialized") {
			window.__send({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: { investigationId: "inv_1" } } });
			if (window.__result) window.__send({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: window.__result });
		}
	});
</script></body></html>`;

describe.skipIf(!available)("investigation view in a real browser", () => {
	let browser: Browser;
	let server: Server;
	let origin: string;

	beforeAll(async () => {
		server = createServer((request, response) => {
			if (request.url === "/view") {
				response.writeHead(200, {
					"Content-Type": "text/html; charset=utf-8",
					"Content-Security-Policy": DEFAULT_CSP,
				});
				response.end(html);
			} else if (request.url === "/host") {
				response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				response.end(HOST_PAGE);
			} else {
				response.writeHead(404);
				response.end();
			}
		});
		await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
		origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
		browser = await chromium.launch({ headless: true });
	}, 60_000);
	afterAll(async () => {
		await browser?.close();
		await new Promise((done) => server?.close(done));
	});

	async function open(
		path: string,
		init: Record<string, unknown>,
		options: { width?: number; colorScheme?: "light" | "dark" } = {},
	) {
		const page = await browser.newPage({
			viewport: { width: options.width ?? 800, height: 900 },
			colorScheme: options.colorScheme ?? "light",
		});
		page.setDefaultTimeout(5000);
		const problems: string[] = [];
		page.on("request", (request) => {
			if (!request.url().startsWith(origin))
				problems.push(`external request ${request.url()}`);
		});
		page.on("dialog", (dialog) => {
			problems.push(`dialog ${dialog.message()}`);
			void dialog.dismiss();
		});
		page.on("console", (message) => {
			if (message.type() === "error")
				problems.push(`console ${message.text()}`);
		});
		page.on("pageerror", (error) =>
			problems.push(`pageerror ${error.message}`),
		);
		await page.addInitScript((values) => {
			Object.assign(window, values);
		}, init);
		await page.goto(`${origin}${path}`);
		return { page, problems };
	}
	const viewFrame = (page: Page) => {
		const frame = page.frames().find((item) => item.url() === `${origin}/view`);
		if (!frame) throw new Error("View frame did not load");
		return frame;
	};

	test("fixture is a contract-valid readInvestigation result", () => {
		expect(validators.Investigation(investigation)).toBe(true);
	});

	test("MCP Apps bridge: handshake, hostile strings as text, exact refs, 320px, host theme, teardown", async () => {
		const { page, problems } = await open(
			"/host",
			{
				__theme: "dark",
				__result: {
					content: [{ type: "text", text: "summary" }],
					structuredContent: investigation,
					isError: false,
				},
			},
			{ width: 320 },
		);
		try {
			await page.waitForFunction(() =>
				(window as never as { __log: Array<{ method?: string }> }).__log.some(
					(item) => item.method === "ui/notifications/size-changed",
				),
			);
			const frame = viewFrame(page);
			await frame.locator("h1").waitFor();

			// Handshake order and shape, as the specification defines it.
			const log = (await page.evaluate(
				() => (window as never as { __log: unknown[] }).__log,
			)) as Array<{
				method?: string;
				id?: number;
				params?: Record<string, unknown>;
			}>;
			expect(log[0]).toMatchObject({
				jsonrpc: "2.0",
				id: 1,
				method: "ui/initialize",
				params: {
					protocolVersion: "2026-01-26",
					appInfo: { name: expect.any(String), version: expect.any(String) },
					appCapabilities: { availableDisplayModes: ["inline"] },
				},
			});
			expect(log[1]).toEqual({
				jsonrpc: "2.0",
				method: "ui/notifications/initialized",
			});
			const sizes = log.filter(
				(item) => item.method === "ui/notifications/size-changed",
			);
			expect(Number(sizes.at(-1)?.params?.height)).toBeGreaterThan(0);
			// Read-only: the view never asks the host to call a tool, open a link or post a message.
			expect(
				log.map((item) => item.method).filter((method) => method !== undefined),
			).toEqual(
				expect.not.arrayContaining([
					"tools/call",
					"ui/message",
					"ui/open-link",
				]),
			);

			// Hostile strings are text. Nothing they describe exists in the DOM and nothing ran.
			expect(await frame.locator("h1").textContent()).toBe(
				investigation.question,
			);
			expect(
				await frame.locator("h3", { hasText: HOSTILE_CLAIM }).textContent(),
			).toBe(HOSTILE_CLAIM);
			expect(
				await frame.locator("img, a, b, button, form, iframe, input").count(),
			).toBe(0);
			expect(await frame.locator("script").count()).toBe(1);
			for (const target of [page, frame])
				expect(
					await target.evaluate(
						() => (window as never as { __pwned?: number }).__pwned,
					),
				).toBeUndefined();

			// Status, revision and snapshots; repository and commit only where a ref names the snapshot.
			const text = (await frame.locator("main").textContent()) ?? "";
			expect(text).toContain("Awaiting a human decision");
			expect(text).toContain("Revision 3");
			const snapshots = frame.locator("h2", {
				hasText: "Snapshots in scope (2)",
			});
			await snapshots.waitFor();
			expect(text).toContain("snap_orders_2");
			expect(text).toContain("repo_payments");

			// Human decisions come first and are styled apart from findings.
			const headings = await frame.locator("h2").allTextContents();
			expect(headings).toEqual([
				"Snapshots in scope (2)",
				"Human decisions (1)",
				"Findings (2)",
			]);
			expect(text).toContain("Human decisions outrank every finding below.");
			const decision = frame.locator("li.card.decision");
			expect(await decision.count()).toBe(1);
			expect(await decision.textContent()).toContain("Constraint");
			expect(await decision.textContent()).toContain("Category: security");

			// Unverified is labelled in words and drawn differently; it never borrows accepted styling.
			const cards = frame.locator("ul > li.card");
			expect(await cards.count()).toBe(2);
			const style = (index: number) =>
				cards.nth(index).evaluate((node) => {
					const badge = node.querySelector(".badge") as HTMLElement;
					return {
						border: getComputedStyle(node).borderTopStyle,
						badge: badge.textContent,
						badgeClass: badge.className,
						background: getComputedStyle(badge).backgroundColor,
					};
				});
			const unverified = await style(0);
			const confirmed = await style(1);
			expect(unverified).toMatchObject({
				border: "dashed",
				badge: "? Unverified",
				badgeClass: "badge v-unverified",
			});
			expect(confirmed).toMatchObject({
				border: "solid",
				badge: "✓ Confirmed by a human",
				badgeClass: "badge v-human_confirmed",
			});
			expect(unverified.background).not.toBe(confirmed.background);
			expect(await cards.nth(0).textContent()).toContain("Model hypothesis");
			// What the claim does not establish travels with the claim, as text.
			expect(
				await cards.nth(0).locator("ul.unknowns > li").allTextContents(),
			).toEqual(investigation.acceptedFindings?.[0]?.unknowns);
			expect(await cards.nth(0).textContent()).toContain("Unknowns (2)");
			expect(await cards.nth(1).locator("ul.unknowns").count()).toBe(0);
			expect(await frame.locator("svg").count()).toBe(0);

			// Exact evidence: short forms on the line, full values in title and in the expander.
			const line = cards.nth(0).locator(".refline").first();
			expect(await line.textContent()).toContain(`@${commit.slice(0, 12)}`);
			expect(await line.textContent()).toContain("bytes [10,42)");
			expect(await line.textContent()).toContain(
				`sha256:${digest.slice(0, 12)}`,
			);
			expect(await line.textContent()).toContain("javascript:alert(1)/");
			expect(await line.locator(`span[title="${commit}"]`).count()).toBe(1);
			expect(await line.locator(`span[title="${digest}"]`).count()).toBe(1);
			const details = cards.nth(0).locator("details").first();
			await details.locator("summary").click();
			const full = (await details.locator("dl").textContent()) ?? "";
			for (const value of [
				commit,
				digest,
				ref.blobId,
				ref.entryId,
				"[10,42)",
				"3-5",
			])
				expect(full).toContain(value);

			// 320px wide with 600-character unbroken strings: no horizontal scroll.
			expect(
				await frame.evaluate(
					() =>
						document.documentElement.scrollWidth <=
						document.documentElement.clientWidth,
				),
			).toBe(true);

			// Host theme signal wins over the OS preference, and follows host-context-changed.
			const background = () =>
				frame.evaluate(() => getComputedStyle(document.body).backgroundColor);
			expect(await background()).toBe("rgb(23, 23, 23)");
			await page.evaluate(() =>
				(window as never as { __send: (message: unknown) => void }).__send({
					jsonrpc: "2.0",
					method: "ui/notifications/host-context-changed",
					params: { theme: "light" },
				}),
			);
			await frame.waitForFunction(
				() => document.documentElement.getAttribute("data-theme") === "light",
			);
			expect(await background()).toBe("rgb(255, 255, 255)");

			// Teardown is acknowledged; an unknown host request is a JSON-RPC method-not-found.
			await page.evaluate(() => {
				const send = (window as never as { __send: (message: unknown) => void })
					.__send;
				send({
					jsonrpc: "2.0",
					id: 41,
					method: "ui/resource-teardown",
					params: { reason: "qa" },
				});
				send({ jsonrpc: "2.0", id: 42, method: "ui/unknown" });
			});
			await page.waitForFunction(() =>
				(window as never as { __log: Array<{ id?: number }> }).__log.some(
					(item) => item.id === 42,
				),
			);
			const replies = (await page.evaluate(() =>
				(window as never as { __log: Array<{ id?: number }> }).__log.filter(
					(item) => item.id === 41 || item.id === 42,
				),
			)) as unknown[];
			expect(replies).toEqual([
				{ jsonrpc: "2.0", id: 41, result: {} },
				{
					jsonrpc: "2.0",
					id: 42,
					error: { code: -32601, message: "Method not found" },
				},
			]);
			expect(problems).toEqual([]);
		} finally {
			await page.close();
		}
	});

	test("MCP Apps bridge: an error result and an empty investigation", async () => {
		const failed = await open("/host", {
			__result: {
				isError: true,
				content: [{ type: "text", text: "{}" }],
				structuredContent: { code: "not_found", message: "Resource not found" },
			},
		});
		try {
			const alert = viewFrame(failed.page).locator('[role="alert"]');
			await alert.waitFor();
			expect(await alert.locator("h1").textContent()).toBe(
				"Investigation unavailable",
			);
			expect(await alert.textContent()).toContain("Resource not found");
			expect(await alert.textContent()).toContain("code: not_found");
			expect(failed.problems).toEqual([]);
		} finally {
			await failed.page.close();
		}

		const bare: Investigation = {
			investigationId: "inv_empty",
			question: "Nothing yet",
			snapshotIds: ["snap_only"],
			revision: 0,
			status: "open",
			createdAt: 1_760_000_000_000,
		};
		expect(validators.Investigation(bare)).toBe(true);
		const empty = await open("/host", {
			__result: { content: [], structuredContent: bare },
		});
		try {
			const frame = viewFrame(empty.page);
			await frame.locator("h1").waitFor();
			const text = (await frame.locator("main").textContent()) ?? "";
			expect(text).toContain("No human decisions recorded.");
			expect(text).toContain("No findings recorded for this revision.");
			expect(text).toContain("Open");
			expect(empty.problems).toEqual([]);
		} finally {
			await empty.page.close();
		}
	});

	test("ChatGPT compatibility: waits, then renders window.openai.toolOutput on openai:set_globals; OS dark theme; unknown status reads as unverified", async () => {
		const { page, problems } = await open(
			"/view",
			{ openai: { toolOutput: null } },
			{ colorScheme: "dark" },
		);
		try {
			await page.locator("#state").waitFor();
			expect(await page.locator("#state").textContent()).toBe(
				"Waiting for the investigation result.",
			);
			// No host theme signal: prefers-color-scheme decides.
			expect(
				await page.evaluate(
					() => getComputedStyle(document.body).backgroundColor,
				),
			).toBe("rgb(23, 23, 23)");

			// A message that does not come from an embedding host is ignored.
			await page.evaluate((data) => {
				window.postMessage(
					{
						jsonrpc: "2.0",
						method: "ui/notifications/tool-result",
						params: { structuredContent: data },
					},
					"*",
				);
			}, investigation);
			await page.waitForTimeout(100);
			expect(await page.locator("h1").count()).toBe(0);

			// Not contract-valid on purpose: a status this view does not know must not look accepted.
			const tampered = structuredClone(investigation) as unknown as {
				acceptedFindings: Array<{ verification: string }>;
			};
			if (tampered.acceptedFindings[1])
				tampered.acceptedFindings[1].verification = "accepted";
			await page.evaluate((data) => {
				const host = (window as never as { openai: Record<string, unknown> })
					.openai;
				host.toolOutput = data;
				host.theme = "light";
				window.dispatchEvent(
					new CustomEvent("openai:set_globals", {
						detail: { globals: { toolOutput: data, theme: "light" } },
					}),
				);
			}, tampered);
			await page.locator("h1").waitFor();
			expect(await page.locator("h1").textContent()).toBe(
				investigation.question,
			);
			expect(
				await page.evaluate(
					() => getComputedStyle(document.body).backgroundColor,
				),
			).toBe("rgb(255, 255, 255)");
			const cards = page.locator("ul > li.card");
			expect(await cards.nth(1).getAttribute("class")).toBe("card unverified");
			expect(await cards.nth(1).locator(".badge").first().textContent()).toBe(
				"? Unverified (status: accepted)",
			);
			expect(
				await page.locator("img, a, b, button, form, iframe").count(),
			).toBe(0);
			expect(
				await page.evaluate(
					() => (window as never as { __pwned?: number }).__pwned,
				),
			).toBeUndefined();
			expect(problems).toEqual([]);
		} finally {
			await page.close();
		}
	});
});
