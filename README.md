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

### Local headless setup (blocked on the pinned backend)

`bun run local:setup` is a **partial implementation**, not a working onboarding step.
It configures local identity and pushes Convex, then stops during fixture ingestion:
the pinned backend refuses an internal mutation combined with CLI `--identity`.
See [the exact failure and evidence](docs/evidence/T08-local-setup.md). Do not use
this command against another checkout's active backend: each checkout has its own
local key, and configuring a different key replaces local trust.

The intended setup is restricted to non-production `THINK_WIDE_MODE=local-demo`
and a literal loopback backend. It reads the operator credential from `.env.local`,
accepts no arguments, and imports only the committed synthetic alpha/beta bundles.
It never executes repository code. Tests exercise the existing internal ingestion
handlers, idempotency, exact reads and grant revocation. Those tests are not a live
setup pass. Normal MCP calls use short-lived JWTs, never the operator credential.

Before every push: `bun run verify` (same command CI runs).

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

Initialized with the official TanStack CLI (add-ons: convex, shadcn, form, nitro, biome). `convex/todos.ts` and its schema are scaffold demo code, kept only as the local read/write smoke test until ticket T02 replaces them. No product capability is implemented yet; every acceptance case in `docs/05_SECURITY_AND_CI.md` is NOT RUN.
