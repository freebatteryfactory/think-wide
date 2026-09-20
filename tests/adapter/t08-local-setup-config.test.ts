import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const exec = promisify(execFile);

describe("local setup refuses unsafe targets before writing", () => {
	test.each([
		{
			THINK_WIDE_MODE: "local-demo",
			NODE_ENV: "production",
			CONVEX_SELF_HOSTED_URL: "http://127.0.0.1:3210",
		},
		{
			THINK_WIDE_MODE: "connected",
			NODE_ENV: "development",
			CONVEX_SELF_HOSTED_URL: "https://example.com",
		},
		{
			THINK_WIDE_MODE: "local-demo",
			NODE_ENV: "development",
			CONVEX_SELF_HOSTED_URL: "http://192.0.2.1:3210",
		},
		{
			THINK_WIDE_MODE: "",
			NODE_ENV: "development",
			CONVEX_SELF_HOSTED_URL: "http://127.0.0.1:3210",
		},
	])("rejects $THINK_WIDE_MODE / $NODE_ENV / $CONVEX_SELF_HOSTED_URL", async (env) => {
		await expect(
			exec("bun", ["scripts/local-setup.ts"], {
				env: {
					...process.env,
					...env,
					CONVEX_SELF_HOSTED_ADMIN_KEY: "NEVER_ECHO_THIS",
				},
				timeout: 5000,
			}),
		).rejects.toMatchObject({
			code: 1,
			stdout: "",
			stderr: expect.stringMatching(
				/^local:setup (refused configuration|requires non-production local-demo mode)/,
			),
		});
	});
	test("does not accept an alternate principal, bundle or deployment argument", async () => {
		await expect(
			exec("bun", ["scripts/local-setup.ts", "--principal=other"], {
				timeout: 5000,
			}),
		).rejects.toMatchObject({
			code: 1,
			stdout: "",
			stderr: "local:setup accepts no arguments\n",
		});
	});
});
