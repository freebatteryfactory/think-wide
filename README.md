# Think-Wide

Cross-repository evidence, durable human decisions, and implementation briefs for people and coding agents, exposed as MCP tools and a web workbench. Think-Wide reasons across projects; coding agents implement inside them. It never edits, builds, tests, or deploys the repositories it reads.

Built during the Coffee & Code Agent hackathon, September 20, 2026. Planning material written before the build window is in [`docs/`](docs/00_START_HERE.md) and is disclosed as prior design work. Application code starts with this repository.

## The problem

Builders with several repositories keep re-solving problems they already solved somewhere else, and coding agents make it worse: each agent sees one repository, starts from zero context, and forgets every correction a human gave it last time. Pasting whole repos into a prompt is slow, leaks private code, and produces confident answers with no way to check them.

Think-Wide gives a person or an agent a small set of tools over an authorized portfolio: browse a snapshot, search it literally or structurally, read **exact** bytes with a digest, record a decision that **survives** regenerated views and stale jobs, and export a brief a coding specialist can act on. Evidence is an address (repository, full commit, blob, byte range, sha256), never a paraphrase. A human correction advances a revision and fences any work computed against the old one.

## Setup (Linux, macOS, Windows via WSL2)

Needs [Bun](https://bun.sh) 1.4+, Docker, git.

```bash
bun install --frozen-lockfile
bun run convex:up                 # self-hosted Convex on 127.0.0.1:3210 (dashboard :6791)
cp .env.example .env.local
bun run convex:key                # paste the output into CONVEX_SELF_HOSTED_ADMIN_KEY in .env.local
bun run convex:dev                # pushes Convex functions and watches
bun run dev                       # http://localhost:3000
```

### Local headless setup

After configuring the local backend URL and admin credential in `.env.local`, set
`THINK_WIDE_MODE=local-demo` there and run:

```bash
bun run local:setup
bun run mcp:stdio
```

Setup configures the local issuer, pushes this checkout's Convex functions, and
registers the committed synthetic alpha/beta snapshots for the local principal.
It accepts no arguments and refuses production or non-loopback targets. The admin
credential is used only by this operator CLI; normal MCP calls use short-lived
user JWTs. Git reading never executes the repositories' code.

Repeating setup reuses the same immutable snapshots and private signing key,
completes interrupted cache writes, and preserves revocation. It does not reset
the database. Do not point another checkout at an active shared backend unless
its ignored signing key is the same: configuring a new key changes local trust.
Restart your MCP client after upgrading so its tool list refreshes.

For explicit **live** acceptance after setup (creates labeled synthetic investigation,
decision and brief rows): `bun tests/adapter/t08-local-live.ts`.
See [commands, evidence and limits](docs/evidence/T08-local-setup.md).

Before every push: `bun run verify` (same command CI runs).

Real-browser checks (focus rings, hover, self-hosted fonts, mobile layout, no console errors, no off-origin requests) are a separate opt-in suite: `bun run browser:install` once, then `bun run test:browser`. Without Chromium it skips and says so; a skip is not a pass.

Only Eassa changes `package.json` / `bun.lock`. Everyone else installs with `--frozen-lockfile`.

## Where things go

See [`docs/REPO_MAP.md`](docs/REPO_MAP.md) for every path and the ticket that owns it.

| Folder | What |
|---|---|
| `contracts/` | hand-written OpenAPI + JSON schemas, the public contract |
| `generated/` | types and validators generated from `contracts/`, never edited |
| `core/` | pure TypeScript rules: grants, revisions, evidence refs, handoffs |
| `convex/` | Convex schema, queries, mutations, actions |
| `src/` | TanStack Start web app (`routes/`, `components/`) and trusted Node server (`server/`) |
| `tests/` | fixtures and acceptance cases Q01–Q18 |
| `infra/` | pinned Convex compose file, deployment config |
| `docs/` | plan, decisions, sanitized evidence |

## How AI agents were used

**In the product.** Think-Wide is built to be driven by agents. Every operation is declared once in `contracts/operations.json`; MCP tool descriptors with self-contained input schemas are generated from it, so an MCP host such as Claude.ai or ChatGPT can call the same operations the web app uses, under the same authorization. Model output is treated as untrusted: it may only reference a closed catalog of UI components and evidence ids, never HTML, CSS, URLs or handlers, and a late model result is rejected if a human has decided in the meantime.

**In building it.** All three of us worked with coding agents (Claude Code, Codex). One Claude Code session acted as coordinator: it ran the GitHub board, wrote tickets, verified every "done" claim against git, and ran adversarial QA on each pull request. Delegated agents implemented scoped briefs. Codex implemented the authorization and decision backend and went through two adversarial rounds before merge. Codex and CodeRabbit review bots commented on pull requests, and every finding was answered as fixed, deferred or rejected. `AGENTS.md` is the single instruction file all of them read. Commit messages carry co-author trailers where an agent wrote the change. Planning documents in `docs/` were written before the event and are disclosed as prior design work; application code starts with this repository.

## Team

| | Role |
|---|---|
| Eassa Ayoub (@heyoub) | Integration: repo and toolchain, contract and codegen, authorization backend, CI, deployment |
| Marc (@Marcandy) | Product and UI: component catalog and workshop, git snapshot reader, workbench and brief |
| Andrew (@adiesh2) | Fixtures and evidence, sandboxed search, security regression, identity |

## Status

As of 2026-09-20. Status levels are separate and never promoted: NOT RUN → fixtures only → local real handlers → live provider/host → deployed.

| Capability | Level |
|---|---|
| Contract + codegen (0.5.0), one operation pipeline, grants / decisions / receipts / run fencing | local real handlers |
| Git snapshots, exact byte-range evidence with sha256, history | local real handlers |
| Workbench, durable decisions with categories, frozen hashed implementation briefs | local real handlers |
| Host-directed reasoning runs and fenced proposals (`beginHostRun`, `submitProposal`) | local real handlers |
| MCP server over stdio (`bun run mcp:stdio`), seeded by `bun run local:setup` | local real handlers, verified from a real MCP client |
| Shared demo catalog (`claimDemoAccess`, `bun run catalog:seed`) | local real handlers; not seeded on the deployed backend, and no UI calls it yet |
| WorkOS AuthKit login with Convex accepting the session token | **deployed**: `https://think-wide.fbf.systems` (evidence on issue #26) |
| Literal + sandboxed structural search | built and tested, not wired to an operation (`searchModes: []`) |
| HTTP transport (`/api/mcp`, `/api/ops/:operationId`) with separate browser and MCP OAuth token profiles | local real handlers; MCP stays unconfigured (503) until a real OAuth token is verified |
| Remote MCP host (Claude.ai / ChatGPT) over OAuth | NOT RUN |
| Public source import (decision 0004) | design only |
| Full-loop recording (T11) | NOT RUN |

A new login on the deployed site sees an empty portfolio until the operator seeds the catalog and the app calls `claimDemoAccess`.
