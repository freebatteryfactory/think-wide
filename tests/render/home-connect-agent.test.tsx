import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ConnectAgent } from "../../src/components/catalog/ConnectAgent";
import {
	browserClipboard,
	COPY_STATUS,
	copyMcpServerUrl,
	MCP_SERVER_URL,
} from "../../src/components/catalog/connect-agent";
import { Route as HomeRoute } from "../../src/routes/index";

// Server render in node, like the rest of tests/render: there is no DOM here, so nothing in this
// file is a click. The copy path is exercised as the exact function the button's handler calls,
// and the live region as the markup it produces for each status. The real click, with a real
// clipboard and with `navigator.clipboard` removed, is tests/browser/home.browser.test.ts.

function occurrences(haystack: string, needle: string): number {
	return haystack.split(needle).length - 1;
}

/** The real home component inside a minimal memory router. No backend URL is configured in
 * this environment, so the repositories panel renders its "not configured" state; it still
 * occupies the same place in the document. */
async function renderHome(): Promise<string> {
	const rootRoute = createRootRoute();
	const routeTree = rootRoute.addChildren([
		createRoute({
			getParentRoute: () => rootRoute,
			path: "/",
			component: HomeRoute.options.component,
		}),
	]);
	const router = createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	await router.load();
	return renderToStaticMarkup(<RouterProvider router={router} />);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("homepage: connect an agent first, investigation ID last (server render)", () => {
	test("the MCP URL is the canonical constant and is printed exactly once", () => {
		expect(MCP_SERVER_URL).toBe("https://think-wide.fbf.systems/api/mcp");
		const html = renderToStaticMarkup(
			<ConnectAgent copyStatus="" onCopy={() => {}} />,
		);
		expect(occurrences(html, MCP_SERVER_URL)).toBe(1);
		expect(html).toMatch(
			new RegExp(`<code[^>]*>${MCP_SERVER_URL.replaceAll(".", "\\.")}</code>`),
		);
		expect(occurrences(html, "think-wide.fbf.systems")).toBe(1);
	});

	test("the copy control is a named button and the status lives in a polite live region", () => {
		const idle = renderToStaticMarkup(
			<ConnectAgent copyStatus="" onCopy={() => {}} />,
		);
		expect(idle).toMatch(
			/<button[^>]*type="button"[^>]*>(<svg[^>]*aria-hidden="true"[^>]*>.*?<\/svg>)? ?Copy MCP server URL<\/button>/s,
		);
		expect(idle).toMatch(/<output[^>]*aria-live="polite"[^>]*><\/output>/);
		const copied = renderToStaticMarkup(
			<ConnectAgent copyStatus={COPY_STATUS.copied} onCopy={() => {}} />,
		);
		expect(copied).toMatch(
			/<output[^>]*aria-live="polite"[^>]*>MCP server URL copied\.<\/output>/,
		);
	});

	test("copying writes the constant to the clipboard and reports it", async () => {
		const writeText = vi.fn(async () => {});
		vi.stubGlobal("navigator", { clipboard: { writeText } });
		await expect(copyMcpServerUrl(browserClipboard())).resolves.toBe(
			COPY_STATUS.copied,
		);
		expect(writeText).toHaveBeenCalledTimes(1);
		expect(writeText).toHaveBeenCalledWith(MCP_SERVER_URL);
	});

	test("a missing or refusing clipboard never throws and never leaks exception text", async () => {
		vi.stubGlobal("navigator", {});
		expect(browserClipboard()).toBeUndefined();
		await expect(copyMcpServerUrl(browserClipboard())).resolves.toBe(
			COPY_STATUS.unavailable,
		);

		vi.stubGlobal("navigator", undefined);
		expect(browserClipboard()).toBeUndefined();

		const refused = await copyMcpServerUrl({
			writeText: async () => {
				throw new Error("NotAllowedError: secret-detail");
			},
		});
		expect(refused).toBe(COPY_STATUS.failed);
		expect(refused).not.toContain("secret-detail");
	});

	test("steps name the two tools and the identity note is present", () => {
		const html = renderToStaticMarkup(
			<ConnectAgent copyStatus="" onCopy={() => {}} />,
		);
		expect(occurrences(html, "<li>")).toBe(3);
		expect(html.indexOf("<code>claimDemoAccess</code>")).toBeGreaterThan(-1);
		expect(html.indexOf("<code>listProjects</code>")).toBeGreaterThan(
			html.indexOf("<code>claimDemoAccess</code>"),
		);
		expect(html).toContain("WorkOS");
		expect(html).toContain(
			"A connector sign-in and a website sign-in are separate identities today",
		);
		expect(html).toContain("not yet visible on this website");
	});

	test("document order: intro, connect section, repositories panel, then the investigation ID form", async () => {
		const html = await renderHome();
		const intro = html.indexOf("never edits, builds or runs the repositories");
		const connect = html.indexOf("Connect your agent");
		const repositories = html.indexOf('aria-label="Repositories"');
		const secondaryHeading = html.indexOf("Already have an investigation ID?");
		const idField = html.indexOf("Investigation ID</label>");
		for (const position of [
			intro,
			connect,
			repositories,
			secondaryHeading,
			idField,
		]) {
			expect(position).toBeGreaterThan(-1);
		}
		expect(intro).toBeLessThan(connect);
		expect(connect).toBeLessThan(repositories);
		expect(repositories).toBeLessThan(secondaryHeading);
		expect(secondaryHeading).toBeLessThan(idField);
		// The whole page still prints the URL once, and the old primary heading is gone.
		expect(occurrences(html, MCP_SERVER_URL)).toBe(1);
		expect(html).not.toContain("Reopen an investigation");
	});
});
