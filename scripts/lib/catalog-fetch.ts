import { Resolver } from "node:dns/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runGit } from "../../src/server/git/process";

export function catalogSelection(input: string) {
	if (
		input.length > 2048 ||
		/\s/.test(input) ||
		/%[01][a-f0-9]|%7f/i.test(input) ||
		[...input].some(
			(character) =>
				character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
		)
	)
		throw new Error("Invalid public repository URL");
	const suffix = input.match(/@([a-f0-9]{40}|[a-f0-9]{64})$/);
	const url = new URL(suffix ? input.slice(0, -suffix[0].length) : input);
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.port ||
		url.pathname === "/" ||
		url.pathname.includes("@") ||
		url.hostname.endsWith(".") ||
		!/^[a-zA-Z0-9.-]+$/.test(url.hostname)
	)
		throw new Error(
			"Use a credential-free public HTTPS repository URL on port 443",
		);
	return { url: url.href, commit: suffix?.[1] };
}

export function publicIpv4(address: string) {
	if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return false;
	const parts = address.split(".").map(Number);
	if (
		parts.length !== 4 ||
		parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
	)
		return false;
	const [a, b, c] = parts;
	return !(
		a === 0 ||
		a === 10 ||
		a === 127 ||
		a >= 224 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 &&
			(b === 168 ||
				(b === 88 && c === 99) ||
				(b === 0 && (c === 0 || c === 2)))) ||
		(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
		(a === 203 && b === 0 && c === 113)
	);
}

/** Invoked only as a resource-limited worker by the operator seed command. */
async function fetchBundle(
	directory: string,
	selection: ReturnType<typeof catalogSelection>,
) {
	const url = new URL(selection.url);
	const resolver = new Resolver({ timeout: 2000, tries: 1 });
	const addresses = await resolver.resolve4(url.hostname);
	if (!addresses.length || addresses.some((address) => !publicIpv4(address)))
		throw new Error(
			"Repository hostname must resolve exclusively to public IPv4 addresses",
		);
	const network = [
		"-c",
		"protocol.https.allow=always",
		"-c",
		"http.followRedirects=false",
		"-c",
		"http.proxy=",
		"-c",
		"credential.helper=",
		"-c",
		"fetch.unpackLimit=1",
		"-c",
		`http.curloptResolve=${url.hostname}:443:${addresses[0]}`,
		"-c",
		"http.lowSpeedLimit=1",
		"-c",
		"http.lowSpeedTime=3",
	];
	let commit = selection.commit;
	if (!commit) {
		const heads = await runGit(
			directory,
			[...network, "ls-remote", "--", selection.url, "HEAD"],
			8192,
		);
		commit = heads
			.toString("ascii")
			.match(/^([a-f0-9]{40}|[a-f0-9]{64})\tHEAD$/m)?.[1];
		if (!commit)
			throw new Error("Repository does not advertise an exact HEAD commit");
	}
	await runGit(directory, [
		"init",
		"--bare",
		"--template=",
		`--object-format=${commit.length === 40 ? "sha1" : "sha256"}`,
		".",
	]);
	await runGit(directory, [
		...network,
		"fetch",
		"--no-tags",
		"--no-recurse-submodules",
		"--",
		selection.url,
		commit,
	]);
	const actual = (
		await runGit(directory, ["rev-parse", "--verify", `${commit}^{commit}`])
	)
		.toString("ascii")
		.trim();
	if (actual !== commit)
		throw new Error("Fetched object does not match the pinned commit");
	await runGit(directory, ["update-ref", "refs/heads/catalog", commit]);
	await runGit(directory, ["symbolic-ref", "HEAD", "refs/heads/catalog"]);
	await runGit(directory, ["bundle", "create", "source.bundle", "HEAD"]);
	return { url: selection.url, commit };
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	const [, , directory, input] = process.argv;
	if (!directory || !input || process.argv.length !== 4) process.exitCode = 1;
	else
		fetchBundle(directory, catalogSelection(input))
			.then((result) => console.log(JSON.stringify(result)))
			.catch(() => {
				console.error(
					"Catalog fetch refused or exceeded public-network/resource bounds",
				);
				process.exitCode = 1;
			});
}
