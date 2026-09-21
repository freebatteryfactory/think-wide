// Pure helpers for the homepage "Connect your agent" section. No React, no DOM lookups: the
// clipboard is passed in, so the same code runs during a server render and in a node test.

/** The one place the public MCP endpoint is written. Deliberately a constant and never derived
 * from `window.location`: the server render and the hydrated page must print the same text. */
export const MCP_SERVER_URL = "https://think-wide.fbf.systems/api/mcp";

export type ClipboardWriter = { writeText(text: string): Promise<void> };

export const COPY_STATUS = {
	copied: "MCP server URL copied.",
	unavailable:
		"Copying is not available in this browser. Select the URL and copy it by hand.",
	failed: "The URL could not be copied. Select it and copy it by hand.",
} as const;

export type CopyStatus = (typeof COPY_STATUS)[keyof typeof COPY_STATUS];

/** `navigator.clipboard` is absent on insecure origins, in older browsers and outside a browser. */
export function browserClipboard(): ClipboardWriter | undefined {
	if (typeof navigator === "undefined") {
		return undefined;
	}
	const clipboard: ClipboardWriter | undefined = navigator.clipboard;
	return typeof clipboard?.writeText === "function" ? clipboard : undefined;
}

/** Never throws and never surfaces exception text: the result is one of three fixed messages. */
export async function copyMcpServerUrl(
	clipboard: ClipboardWriter | undefined,
): Promise<CopyStatus> {
	if (!clipboard) {
		return COPY_STATUS.unavailable;
	}
	try {
		await clipboard.writeText(MCP_SERVER_URL);
		return COPY_STATUS.copied;
	} catch {
		return COPY_STATUS.failed;
	}
}
