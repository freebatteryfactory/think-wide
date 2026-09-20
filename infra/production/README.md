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
host admission semantics must be settled before implementation. Neither blocks private
infrastructure preparation. Devpost materials remain with the coordinator.

## Topology and current limitations

Default services are `backend` and `backend-tls`. Convex API/action listeners bind
only `127.0.0.1:3210/3211`; admin dashboard is an optional profile, also loopback.
The private Caddy terminates `https://convex.internal:8443` using its own CA. The app
mounts **only the public root certificate**, using Node's `NODE_EXTRA_CA_CERTS`;
it cannot access the CA private key or the Convex admin/instance credentials.

Issue #26's newer comment recommends public TLS Convex for T09's reactive browser
client. **Claude owns that website/topology decision.** Private preparation neither
rewrites the browser nor authorizes exposing Convex. A public backend would need its
own DNS/TLS route and the same I01 authenticated/foreign-principal acceptance gates.
The image currently bakes `https://convex.invalid` into the obsolete scaffold provider
to avoid a build-time missing-variable crash. It is a **private preparation artifact**,
not a usable website. The website owner must replace this with the reviewed browser
configuration and build a new verified image before activation.

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
`THINK_WIDE_MODE=connected`, then push the verified schema/functions. Keep
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
reach external providers. Inspect through a separate SSH-forwarded loopback port.
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

- I01 WorkOS verified through the real browser and backend; missing/foreign callers denied.
- Claude's topology decision implemented and reviewed; correct build-time browser URL.
- Backend deployment env inspected: connected, no local JWKS or unisolated switch.
- App entrypoint tested in production; no admin key, local identity or disabled TLS.
- Exact verified commit/image staged; pre-change backup and restore rehearsal complete.
- DNS-only hostname points here; Caddy security headers and certificate tested.
- Only then consider `application` / `public` profiles and `compose.public.yml`.
  Compose's public override is separate intentionally; preparation never loads it.
- Remote MCP is another milestone: T08 HTTP transport plus real host OAuth and evidence.

`getCapabilities` must continue describing measured integrations, never deployment intent.
