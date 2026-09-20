# G0: event record

Each module below stands alone: one fact family, its source, its status, its owner. Fill or correct a module without touching the others. `CONFIRMED` means a source is cited. `OPEN` means a named person still owes the answer. Nothing here is an eligibility ruling.

Sources: [D1] https://coffee-and-code-agent.devpost.com/ and [D2] https://coffee-and-code-agent.devpost.com/rules, both retrieved 2026-09-20 15:20 EDT by the coordinator session. Earlier retrieval: docs/08_SOURCES.md S01.

## M1 · Event · CONFIRMED [D1]
AI Agent Hackathon, organized by Coffee and Code Philadelphia. In person. Build day 2026-09-20 at Pennovation Center, 3401 Grays Ferry Ave, Philadelphia. Awards 2026-09-22, 19:00, Cesium, 601 Walnut St. Build time 11:10–18:00 EDT. **Devpost submission deadline 18:00 EDT, 2026-09-20** [D2]. Teams or solo. Organizer contact: raphael@codephilly.com. The event page names Claude Code and Codex among the expected tools; no restriction on AI tools is stated.

## M2 · Tracks we can enter · OPEN (owner: Eassa picks; more than one is allowed)
"Your project can solve any problem and may also compete in another hackathon track." [D1]

| Track | Prize | What it takes | Fit |
|---|---|---|---|
| **Bring Your Own Project (open)** | $400 | Judged on technical execution, agentic design, innovation, impact, reliability & safety (failure modes, permissions, guardrails), demo & completeness | Strong. The permission model, fencing and honesty rules are exactly the "reliability & safety" criterion |
| **The Code Registry** | 12-month plan ($3,600) | See M3. Highest Code Score wins; tiebreak security, then quality | Eligible on every structural rule today (M3) |
| **GalaxyGate** | $1,000 compute credits | **No requirements published** on [D1]/[D2]. We deploy on a GalaxyGate VPS (I04) | OPEN: ask staff on site what qualifies |
| Quirq: Build It | $500 + credits | Must run through Quirq with xo-space visibility; 25% of the score is that display | Not planned. Would need a Quirq integration we have not scoped |
| Quirq: Break It / HumanStandard | — | Security bounty on Quirq / music-detection API | Not applicable |

## M3 · Code Registry eligibility · CONFIRMED against [D2], measured on `main` at `2c14b99`
| Rule [D2] | State |
|---|---|
| New **public** GitHub repo created on 20 September with "hackathon" in the name | `freebatteryfactory/think-wide-hackathon`, public, created 2026-09-20T13:49:43Z (09:49 EDT) ✓ |
| ≥ 1,500 lines of source across ≥ 10 files | 5,371 hand-written lines in 70 files, excluding tests, generated output and vendored UI ✓ |
| ≥ 3 third-party dependencies in a manifest | 24 runtime, 13 dev in `package.json` ✓ |
| README covers: what it does, problem solved, how to run, **AI agent usage**, **team** | ✓ as of this commit |
| Valid submission: working prototype, repository, description, demo | OPEN: depends on the product loop (M6) |
| **Stop building at 17:30.** Register with The Code Registry, create a project, start the repository sync **before 18:00** | OPEN: owner Eassa |
| Log team name, repository URL and Code Registry account email **with staff before leaving** | OPEN: owner Eassa |
Participants do not see their Code Score during the event. Private repos are not scored.

## M4 · Organizer ruling on early initialization · OPEN (owner: Eassa)
Two commits predate 11:10: `30d77b8` (planning docs only) and `bc3a418` (11:02, tool scaffolds and config, no product logic). Eassa was told verbally that init and dependency setup before build time was fine. Needed: the organizer's name and the time, or a message/screenshot. [D1]/[D2] state no rule about pre-existing work at all, which makes the verbal ruling consistent with the published rules, but this module stays OPEN until the source is written here. Nothing is backdated or squashed.

## M5 · Disclosure · CONFIRMED (facts), to be copied into the Devpost description
- Planning package (`docs/0*.md`, tickets, roles) written before the event. No application code. Product was called "Revive" in it until renamed Think-Wide on the morning of 2026-09-20.
- An earlier prototype exists outside this repository. Not copied, imported or used.
- Pre-existing infrastructure: one GalaxyGate VPS (also hosting an unrelated project of Eassa's), a WorkOS account, the GitHub org, the `fbf.systems` domain.
- Scaffolds and libraries: official TanStack CLI output, shadcn/ui components, Fontsource fonts, everything in `package.json`.
- AI assistance: all three teammates use coding agents (Claude Code, Codex). A Claude Code coordinator session ran the board, reviews and adversarial QA and wrote part of the contract and configuration; delegated agents implemented specific briefs; Codex implemented T06. Commit messages carry the co-author trailers. Codex and CodeRabbit review bots comment on PRs.

## M6 · Product status for the submission · OPEN (owner: whole team; update before recording)
Built and verified with local real handlers (main `672038f`): contract + codegen (T02), fixtures and harness (T04), git snapshots and exact reads (T05), authorization / decisions / receipts / run fencing (T06), MCP stdio server with local setup (T08), workbench and frozen hashed briefs (T09), host-directed runs and fenced proposals (T10), source-to-brief regression tests (T11), decision categories, shared demo catalog backend, themed component workshop (T03). Built but not wired to an operation: literal + sandboxed structural search (T07). **Deployed:** WorkOS login on `https://think-wide.fbf.systems` with the Convex backend accepting the session token (I01 + I04, evidence on #26); the deployed portfolio is empty until the catalog is seeded and the app calls `claimDemoAccess`. NOT RUN: remote MCP host over OAuth (PR #42), public source import (decision 0004, design only), the full-loop recording. The first-acceptance sentence below is met on the local demo backend through the MCP stdio server; it is **not** met on the deployed host, and a recording must label which one it shows.

First acceptance, as agreed: two immutable repos, one cross-project discovery, one exact evidence expansion, one retained correction that changes reasoning, one reopened investigation, one useful implementation brief. One authenticated remote MCP host if its gate passes; a local demo is never relabeled as that.

## M7 · Reasoning model and budget · OPEN (owner: Eassa)
Provider, model id and a spend cap for backend-directed reasoning (T10). Host-directed reasoning (an MCP client such as Claude.ai supplies the model) needs no budget from us and is the cheaper path to a live demo. The app reads the provider key from the environment (`.env.local`); no provider is hardcoded in the contract.

## M8 · Demonstration data · CONFIRMED in trunk, pending two 👍
`tests/fixtures/repos/alpha.bundle` and `beta.bundle`: real git repositories with real commits, synthetic, labeled, reproducible with `scripts/make-fixture-repos.ts`. Proposed as the two demo repositories. Marc and Andrew to confirm on issue #5.

## M9 · Team, mode, hostname · CONFIRMED
Eassa @heyoub (integration), Marc @Marcandy (product and UI), Andrew @adiesh2 (fixtures, security, evidence; now also identity, I01). Current mode `local-demo`: self-hosted Convex on each developer's loopback. Hostname reserved for deployment: `think-wide.fbf.systems` → VPS `162.248.101.225`, DNS-only, SSH key-only. Since 2026-09-20 the authenticated website is served there (`think-wide.fbf.systems` and `convex.think-wide.fbf.systems`, ports 80/443 only); remote MCP is NOT RUN.
