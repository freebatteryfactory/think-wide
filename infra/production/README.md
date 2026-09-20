# I04 private deployment preparation

Ticket [#26](https://github.com/freebatteryfactory/think-wide-hackathon/issues/26).
This directory owns infrastructure only. The existing local Compose file is unchanged.
No command here activates public ingress. Website implementation belongs to Claude;
I01 belongs to Andrew, T09 to Marc, local setup to the separate T08 branch.

## Execution plan and gates

1. Pin container images; prepare a dedicated Compose project and private credentials.
2. Start private Convex and verify TLS without changing the app's HTTPS requirement.
3. Verify a clean commit, build an immutable image, stage it without publishing it.
4. Demonstrate cold backup, isolated restore, stable document IDs, and off-host copy.
5. Constrain host ingress while preserving SSH and existing Battle Intel services.
6. Open the infrastructure PR and hand the public activation checklist to the website owner.

**Separate work:** T08 #21 seeds the local MCP demo. T07 #7 still needs a reviewed
Node/Convex execution boundary; a literal operation special case in dispatch would
violate the generated registry. `submitProposal` merits a separate T10 backend ticket:
issue #28 now chooses explicit admission before reasoning, reusing existing run fences. Neither blocks private
infrastructure preparation. Devpost materials remain with the coordinator.

## Topology and current limitations

Default services are `backend` and `backend-tls`. Convex API/action listeners bind
only `127.0.0.1:3210/3211`; admin dashboard is an optional profile, also loopback.
The private Caddy terminates `https://convex.internal:8443` using its own CA. The app
mounts **only the public root certificate**, using Node's `NODE_EXTRA_CA_CERTS`;
it cannot access the CA private key or the Convex admin/instance credentials.

Issue #26 and the accepted activation brief retain T09's reactive browser client:
the reviewed public override routes `convex.think-wide.fbf.systems` to the API listener.
Caddy 2.11.2 handles WebSocket upgrades automatically; no manual upgrade headers are
needed. The dashboard and action listener remain loopback-only. Public Convex API
access still depends on the existing authenticated operation pipeline; the proxy is
not an authorization substitute. Administrative API routes on that listener remain
protected by Convex's admin authentication; admin keys are never supplied to Caddy or
the app. Administrative clients continue using the loopback/SSH path.

The public override changes `CONVEX_CLOUD_ORIGIN` and joins ingress to the private
network. Base Compose alone publishes no ingress ports and cannot route the public
Convex site. Nothing in preparation loads this override or activates a listener.
Both DNS-only hostnames and I01 browser acceptance remain activation gates.

Release builds require `VITE_CONVEX_URL=https://convex.think-wide.fbf.systems` and
`VITE_THINK_WIDE_IDENTITY=workos` (the identity default is workos). Both are baked in
and recorded in the release manifest. Runtime environment cannot repair an image
built without them. Rebuild from the accepted I01 commit before activation; building
this preparation commit alone does not supply the still-separate browser identity work.

Public responses include HSTS (`max-age=31536000`, deliberately no preload or
includeSubDomains), framing/content-type protections, and an application CSP whose
`connect-src` allows only self plus the public Convex HTTPS/WSS origins. Hosted
WorkOS login uses top-level navigation, so it does not need a WorkOS `connect-src`
exception. CSP currently permits inline scripts/styles because TanStack Start emits
inline hydration and the UI uses inline styles; there is no `unsafe-eval`. A strict
nonce policy needs support in the app's renderer and is not claimed here. Browser
login/hydration under these headers must pass before activation.

Native analyzer binaries/confinement are not supplied by this app image. T07 must
provide a confined worker with scoped AppArmor allowance and prove it on this host.
Never set `THINKWIDE_ALLOW_UNISOLATED_ANALYZER`, globally disable user namespace
confinement, or advertise structural search before that proof.

## Private bootstrap

Requirements: Linux, Python 3.11+, Docker Engine and Compose, authenticated SSH.
Copy this directory to `/opt/think-wide/infra` (root-only parent, mode 0700), then:

```sh
python3 /opt/think-wide/infra/control.py bootstrap
python3 /opt/think-wide/infra/control.py check
```

Generated state is in `/opt/think-wide/shared`: `backend.env.local` contains instance
credentials, `admin.env.local` the CLI-only key, and `app.env.local` is reserved for
I01 provider credentials. All are 0600 under a 0700 directory. Do not copy the admin
key to any app environment, route, image, log or browser. Images are digest-pinned
in `images.env`; upgrading a pin requires a new recovery rehearsal.

Bootstrap is repeatable and does not reset credentials/data. Control commands take a
per-project maintenance lock. Run them as the same administrator; do not concurrently
run raw Compose mutations. Production defaults never trust a local-demo issuer.
After first bootstrap, use the installed Convex CLI over an SSH tunnel to set backend
`THINK_WIDE_MODE=connected` and `WORKOS_CLIENT_ID`, then push the verified schema/functions. Keep
`THINK_WIDE_LOCAL_JWKS` and the unisolated-analyzer switch absent. This mode alone does
not prove WorkOS works: until I01, the backend has no trusted provider.

```sh
ssh -N -L 9321:127.0.0.1:3210 think-wide-vps
# Private CLI env file targets http://127.0.0.1:9321, never the public IP.
bunx convex dev --once --typecheck enable --codegen disable --env-file /private/admin.env.local
```

CLI credentials authorize infrastructure administration only. Application checks must
use real user tokens. Never test user permissions with the admin key.

## Immutable releases

```sh
# From a clean, committed checkout; performs the full repository gate itself.
VITE_CONVEX_URL=https://convex.think-wide.fbf.systems \
VITE_THINK_WIDE_IDENTITY=workos \
  infra/production/build-release.sh /absolute/new/private/release-directory
# Transfer this directory over authenticated SSH, then on the VPS:
python3 /opt/think-wide/infra/stage-release.py /absolute/upload-directory
```

The release manifest binds source commit, Docker content image ID and tar SHA-256.
The loader checks the image's revision label and non-root user. Retain the image tar,
manifest and matching infrastructure directory off-host; a checksum alone does not
establish provenance. Stage never starts the app or changes the active release.

## Cold backup and isolated recovery

Quiesce the website/ingress first if they have ever been activated; backup refuses a
running app. Schedule downtime: this is a **cold** consistent copy of SQLite, blobs,
CA state and deployment credentials, not an online SQLite tar.

```sh
python3 /opt/think-wide/infra/control.py backup
python3 /opt/think-wide/infra/control.py restore \
  --project think-wide-restore-rehearsal --root /opt/think-wide-restore-rehearsal \
  --backend-port 43210 --actions-port 43211 \
  --backup /opt/think-wide/backups/EXACT_BACKUP_DIRECTORY
python3 /opt/think-wide/infra/control.py bootstrap \
  --project think-wide-restore-rehearsal --root /opt/think-wide-restore-rehearsal \
  --backend-port 43210 --actions-port 43211
```

Restore refuses existing roots/volumes, wrong image pins, missing original credentials,
checksum changes and unsafe tar members. It never overwrites production. Restore
projects **always** use an internal Docker network, so copied scheduled actions cannot
reach external providers. Docker 29 does not publish ports for this internal network. Inspect with the pinned
Convex CLI in a temporary container attached only to the restore network, with its
restored CLI credentials. Install CLI dependencies before attaching that container
to the isolated network; never grant the restore backend outbound connectivity.
Compare exported document IDs/content and deployment environment/schema with the
pre-backup record before declaring recovery. Keep backup directories mode 0700 and
files 0600; copy them off-host through SSH to protected storage. They contain secrets
and application data. Do not commit archives or post their contents.

### Schema-aware rollback

Keep the last verified application image and a **pre-migration** cold backup together.
If a release changes no backend schema/semantics, an operator can restore the previous
image ID after confirming compatibility. After a migration, do **not** merely run an
old binary on a new database. Quiesce traffic, restore the paired pre-migration backup
into a new isolated project using its exact pinned infrastructure version, verify
schema/data/functions and original credentials, then review a cutover. Writes after
that backup require a reconciliation plan; they are not silently discarded. There is
no automated destructive rollback or cross-version SQLite downgrade in these scripts.

## Public activation handoff — NOT RUN

1. Merge and independently verify I01 through the real browser/backend; deny
   missing/foreign callers. This infrastructure PR does not supply browser identity.
2. Copy `app.env.template` to the protected `shared/app.env.local` (0600), filling
   credentials privately. Never source this template as working credentials.
   Register its exact redirect URI in the same WorkOS environment. The client ID
   must match the one on the Convex deployment. The cookie password needs at least
   32 characters. No provider credential is a build arg or part of the image.
3. Set **deployment** env `THINK_WIDE_MODE=connected` and `WORKOS_CLIENT_ID` using
   the operator CLI, then push the reviewed Convex auth/functions. Auth config needs
   explicit mode: leaving it unset fails deployment. Remove `THINK_WIDE_LOCAL_JWKS`
   and `THINKWIDE_ALLOW_UNISOLATED_ANALYZER`, even when their values are empty.
4. Run `python3 /opt/think-wide/infra/control.py check-connected`. This required
   preflight reads the actual deployed environment using the CLI-only admin file,
   requires exact connected mode, the same nonempty WorkOS client ID as the app,
   and absence of development authority. It makes one read-only HTTP query over
   the exact installation loopback listener; redirects and proxies are not followed.
   It never prints returned deployment settings or credentials. Configuration-only
   `check` still exists for empty private bootstrap and is **not** this gate.
5. Verify production entrypoint refusals, the exact accepted image's build flags,
   backup/restore readiness, both DNS records, and the reviewed Caddy configuration.
6. Only the activation owner may then load `compose.public.yml` with `application`
   and `public` profiles, and perform external certificate, CSP, WebSocket,
   real-login and cross-principal acceptance. There is deliberately no activation
   command in `control.py`; manually invoking Docker can bypass a preflight, so
   these steps are required operator gates rather than an automatic security boundary.
7. Record the measured website result separately. Remote MCP still needs the T08
   HTTP transport and real host OAuth acceptance. The app template sets
   `MCP_RESOURCE_URL=https://think-wide.fbf.systems/api/mcp` for the transport's
   protected-resource metadata. This requires connected mode and the matching
   WorkOS client ID; it does not configure an OAuth authorization server or prove
   a Claude.ai/ChatGPT connection. OAuth authorization-server integration and real
   remote-host acceptance remain **NOT RUN**. Missing HTTP transport configuration
   is not a website activation prerequisite. Capabilities describe evidence,
   never this checklist's intent.

### Verification and compatibility references

- `python3 -m unittest discover -s infra/production -p test_control.py`: filesystem,
  restore, and local HTTP protocol fixtures. These are infrastructure tests, not a
  real WorkOS or deployed-backend acceptance claim.
- `bun run verify`: full repository gate before push.
- Validate `Caddyfile` with the exact digest in `images.env` using `caddy validate`;
  no running production services or certificate requests are needed for validation.
- [Caddy 2.11.2 upgrade implementation](https://github.com/caddyserver/caddy/blob/v2.11.2/modules/caddyhttp/reverseproxy/streaming.go)
  and [header directive](https://caddyserver.com/docs/caddyfile/directives/header).
- [Convex HTTP query API](https://docs.convex.dev/http-api/) and installed Convex
  **1.46.0** `src/cli/lib/env.ts` / `src/browser/http_client.ts`: preflight uses the
  same `_system/cli/queryEnvironmentVariables` query as the CLI. This administrative
  system query is version-sensitive: recheck it on a backend/SDK upgrade. Protocol
  fixtures and a disposable pinned local Convex backend passed (connected config
  accepted, empty local JWKS rejected). No WorkOS token was used in this check;
  it proves configuration inspection only. Running it on the VPS remains
  activation-owner work.

## Host firewall and analyzer preparation

The VPS uses UFW 0.36.2 with default deny inbound and TCP 22/80/443 allowed for
IPv4 and IPv6. Outbound traffic and established connections remain allowed. During
initial activation a systemd timer armed `ufw disable` as a rollback; a fresh SSH
connection and service checks succeeded before the timer was cancelled.

Docker published ports bypass UFW's normal INPUT rules. Therefore the deployment
configs must also enforce loopback-only backend/admin listeners and publish only
80/443 on the gated public proxy. Do not treat UFW as protection for a container
accidentally published on `0.0.0.0:3210`. Recheck Docker port mappings on every release.
See [Docker firewall guidance](https://docs.docker.com/engine/network/packet-filtering-firewalls/)
and [Ubuntu UFW guidance](https://ubuntu.com/server/docs/how-to/security/firewalls/).

Bubblewrap 0.9.0-1ubuntu0.3 is installed on the host. The kernel's AppArmor user
namespace restriction remains enabled. Installation alone does not establish the
worker's isolation or enable structural search; T07 must prove the actual worker
profile/runtime. Battle Intel units, listeners and Cloudflare tunnel config remain
untouched.
