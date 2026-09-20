import { describe, expect, test } from "vitest";
import { catalogSelection, publicIpv4 } from "../../scripts/lib/catalog-fetch";

describe("trusted operator public Git selection", () => {
	test("accepts public HTTPS URLs and optional immutable pins", () => {
		expect(catalogSelection("https://github.com/example/repo")).toEqual({
			url: "https://github.com/example/repo",
			commit: undefined,
		});
		for (const size of [40, 64])
			expect(
				catalogSelection(`https://git.example/repo.git@${"a".repeat(size)}`)
					.commit,
			).toBe("a".repeat(size));
	});
	test.each([
		"file:///tmp/repo",
		"ssh://git@example/repo",
		"http://example/repo",
		"https://user:password@example/repo",
		"https://example/repo?token=secret",
		"https://example/repo#main",
		"https://example:8443/repo",
		"https://example/repo@main",
		"https://example/repo\n",
		"https://example/repo%00",
		"https://[::1]/repo",
		"https://example./repo",
	])("rejects unsafe or mutable selection %s", (url) =>
		expect(() => catalogSelection(url)).toThrow());
	test.each([
		"127.0.0.1",
		"10.0.0.1",
		"172.16.0.1",
		"192.168.1.1",
		"169.254.169.254",
		"100.64.0.1",
		"0.0.0.0",
		"224.0.0.1",
		"255.255.255.255",
		"192.0.2.1",
		"198.51.100.1",
		"203.0.113.1",
		"198.18.0.1",
		"::1",
		"1.1.1.999",
		"1.1.1",
		"1..1.1",
	])("rejects non-public IPv4 %s", (address) =>
		expect(publicIpv4(address)).toBe(false));
	test("accepts ordinary public IPv4 addresses", () =>
		expect(publicIpv4("140.82.112.3")).toBe(true));
});
