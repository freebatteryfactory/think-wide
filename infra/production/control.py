#!/usr/bin/env python3
"""Private I04 preparation and cold recovery. Deliberately has no public deploy command."""
import argparse
import hashlib
import http.client
import fcntl
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import shutil
import subprocess
import tarfile
import time

HERE = Path(__file__).resolve().parent
VOLUMES = ("data", "internal_tls", "public_tls")
SECRET_FILES = ("backend.env.local", "app.env.local", "admin.env.local")
FORBIDDEN = {"THINK_WIDE_LOCAL_JWKS", "THINKWIDE_ALLOW_UNISOLATED_ANALYZER"}


def run(args, *, env=None, capture=False):
    return subprocess.run(args, env=env, check=True, text=True,
                          stdout=subprocess.PIPE if capture else None,
                          stderr=subprocess.PIPE if capture else None).stdout


def env_file(path):
    result = {}
    for line in path.read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        key, sep, value = line.partition("=")
        if not sep or not re.fullmatch(r"[A-Z][A-Z0-9_]*", key) or key in result:
            raise ValueError("Invalid environment file")
        result[key] = value
    return result


def private_file(path, content):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as file:
        file.write(content)


def sha256(path):
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


class Installation:
    def __init__(self, root, project, backend_port=3210, actions_port=3211):
        if not re.fullmatch(r"think-wide-(production|restore-[a-z0-9-]+)", project):
            raise ValueError("Only dedicated Think-Wide production/restore projects are allowed")
        if not (1024 <= backend_port <= 65535 and 1024 <= actions_port <= 65535) or backend_port == actions_port:
            raise ValueError("Use two distinct unprivileged ports")
        if project.startswith("think-wide-restore-") and (backend_port in {3210, 3211} or actions_port in {3210, 3211}):
            raise ValueError("Restore listeners must not overlap production")
        self.root = Path(root).absolute()
        self.project = project
        self.state = self.root / "shared"
        self.images = env_file(HERE / "images.env")
        if not all(re.fullmatch(r"[a-z0-9./_-]+@sha256:[a-f0-9]{64}", v) for v in self.images.values()):
            raise ValueError("Infrastructure images must use registry digests")
        self.env = {k: v for k, v in os.environ.items() if k in {"PATH", "HOME", "DOCKER_HOST", "DOCKER_CONTEXT"}}
        self.env.update(self.images)
        self.env.update(STATE_DIR=str(self.state), COMPOSE_DISABLE_ENV_FILE="1",
                        BACKEND_PORT=str(backend_port), ACTIONS_PORT=str(actions_port))

    def compose(self, *args, capture=False):
        config = ["-f", str(HERE / "compose.yml")]
        if self.project.startswith("think-wide-restore-"):
            config += ["-f", str(HERE / "compose.restore.yml")]
        return run(["docker", "compose", "-p", self.project, *config, *args], env=self.env, capture=capture)

    def initialize(self):
        for directory in (self.root, self.state, self.root / "backups", self.root / "releases"):
            if directory.is_symlink():
                raise ValueError("Deployment directories must not be symlinks")
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            if directory.stat().st_mode & 0o077:
                raise ValueError("Deployment directories must be private (0700)")
        backend = self.state / "backend.env.local"
        if not backend.exists():
            private_file(backend, "INSTANCE_NAME=think-wide-production\nINSTANCE_SECRET=" + secrets.token_hex(32) + "\n")
        app = self.state / "app.env.local"
        if not app.exists():
            private_file(app, "# I01 installs production provider credentials here; never CLI/admin credentials.\n")
        self.check_environment()

    def check_environment(self):
        for name in SECRET_FILES:
            path = self.state / name
            if not path.exists():
                continue
            if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
                raise ValueError("Secret files must be regular private files (0600)")
            values = env_file(path)
            if FORBIDDEN.intersection(values) or values.get("THINK_WIDE_MODE", "connected") != "connected":
                raise ValueError("Development authority/analysis settings are forbidden")
            if name == "app.env.local" and {"CONVEX_SELF_HOSTED_ADMIN_KEY", "INSTANCE_SECRET"}.intersection(values):
                raise ValueError("Application environment must not contain admin credentials")
        backend = env_file(self.state / "backend.env.local")
        if set(backend) != {"INSTANCE_NAME", "INSTANCE_SECRET"} or not re.fullmatch(r"[a-f0-9]{64}", backend["INSTANCE_SECRET"]):
            raise ValueError("Invalid backend instance configuration")

    def check_connected(self):
        """Read-only activation prerequisite; never starts containers or writes env."""
        self.check_environment()
        app = env_file(self.state / "app.env.local")
        required = ("WORKOS_API_KEY", "WORKOS_CLIENT_ID", "WORKOS_COOKIE_PASSWORD")
        if any(not app.get(name, "").strip() for name in required):
            raise ValueError("WorkOS app credentials must be configured")
        if len(app["WORKOS_COOKIE_PASSWORD"]) < 32:
            raise ValueError("WorkOS cookie password must contain at least 32 characters")
        if (app.get("THINK_WIDE_IDENTITY") != "workos"
                or app.get("WORKOS_REDIRECT_URI") != "https://think-wide.fbf.systems/api/auth/callback"):
            raise ValueError("Connected identity and the production redirect URI are required")
        admin = env_file(self.state / "admin.env.local")
        # Explicit literal loopback only: no DNS, proxy environment, redirects or TLS bypass.
        expected_url = f"http://127.0.0.1:{self.env['BACKEND_PORT']}"
        if admin.get("CONVEX_SELF_HOSTED_URL") != expected_url:
            raise ValueError("Admin query must target this installation's loopback listener")
        key = admin.get("CONVEX_SELF_HOSTED_ADMIN_KEY", "")
        if not key or any(c.isspace() for c in key):
            raise ValueError("Missing or malformed administrative credential")
        # Same system query as convex 1.46.0 src/cli/lib/env.ts. This CLI-only
        # dependency must be checked when upgrading the pinned backend/Convex SDK.
        request = json.dumps({"path": "_system/cli/queryEnvironmentVariables",
                              "args": {}, "format": "json"})
        connection = http.client.HTTPConnection("127.0.0.1", int(self.env["BACKEND_PORT"]), timeout=10)
        try:
            connection.request("POST", "/api/query", request,
                               {"Content-Type": "application/json", "Authorization": "Convex " + key})
            response = connection.getresponse()
            if response.status != 200:
                raise RuntimeError("Deployment environment query failed")
            body = response.read(1024 * 1024 + 1)
            if len(body) > 1024 * 1024:
                raise RuntimeError("Deployment environment response exceeded limit")
            result = json.loads(body)
        finally:
            connection.close()
        if not isinstance(result, dict) or result.get("status") != "success" or not isinstance(result.get("value"), list):
            raise RuntimeError("Deployment environment query returned an invalid response")
        values = {}
        for row in result["value"]:
            if (not isinstance(row, dict) or not isinstance(row.get("name"), str)
                    or not isinstance(row.get("value"), str) or row["name"] in values):
                raise RuntimeError("Deployment environment query returned invalid variables")
            values[row["name"]] = row["value"]
        if (values.get("THINK_WIDE_MODE") != "connected"
                or not values.get("WORKOS_CLIENT_ID", "").strip()
                or values["WORKOS_CLIENT_ID"] != app["WORKOS_CLIENT_ID"]
                or FORBIDDEN.intersection(values)):
            raise ValueError("Deployment must use matching WorkOS identity without development authority")
        print("Connected deployment settings verified; browser identity and public activation still require acceptance.")

    def bootstrap(self):
        self.initialize()
        self.compose("up", "-d", "--wait", "backend", "backend-tls")
        # Only the PUBLIC root is copied. The app never mounts the CA's private volume.
        source = "/data/caddy/pki/authorities/local/root.crt"
        for _ in range(30):
            try:
                cert = self.compose("exec", "-T", "backend-tls", "cat", source, capture=True)
                break
            except subprocess.CalledProcessError:
                time.sleep(1)
        else:
            raise RuntimeError("Private TLS authority did not initialize")
        if not cert.startswith("-----BEGIN CERTIFICATE-----"):
            raise RuntimeError("Missing public CA certificate")
        certificate_path = self.state / "convex-root.crt"
        certificate_path.write_text(cert)
        certificate_path.chmod(0o644)
        admin = self.state / "admin.env.local"
        if not admin.exists():
            key = self.compose("exec", "-T", "backend", "./generate_admin_key.sh", capture=True).strip()
            if not key or "\n" in key:
                raise RuntimeError("Unexpected admin key generator output")
            private_file(admin, f"CONVEX_SELF_HOSTED_URL=http://127.0.0.1:{self.env['BACKEND_PORT']}\nCONVEX_SELF_HOSTED_ADMIN_KEY={key}\n")
        print("Private backend and TLS initialized; credentials were not printed.")

    def volume(self, name):
        return f"{self.project}_{name}"

    def owned_volume(self, name):
        info = json.loads(run(["docker", "volume", "inspect", self.volume(name)], capture=True))[0]
        if info.get("Labels", {}).get("com.docker.compose.project") != self.project:
            raise RuntimeError("Volume does not belong to this Compose project")
        return info

    def backup(self):
        self.check_environment()
        if not all((self.state / name).is_file() for name in SECRET_FILES):
            raise ValueError("Bootstrap and restore missing configuration before backing up")
        # Backups are maintenance operations. Never silently stop a live public app.
        for service in ("app", "ingress"):
            if run(["docker", "ps", "-q", "--filter", "label=com.docker.compose.project=" + self.project,
                    "--filter", "label=com.docker.compose.service=" + service], capture=True).strip():
                raise RuntimeError("Quiesce the application and ingress before taking a cold backup")
        for name in ("data", "internal_tls"):
            self.owned_volume(name)
        target = self.root / "backups" / (time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + "-" + secrets.token_hex(3))
        target.mkdir(mode=0o700)
        try:
            self.compose("stop", "backend-tls", "backend")
            if self.compose("ps", "--status", "running", "-q", "backend", "backend-tls", capture=True).strip():
                raise RuntimeError("Backend must be stopped before copying SQLite and blob files")
            artifacts = {}
            volumes = []
            for name in VOLUMES:
                try:
                    self.owned_volume(name)
                except subprocess.CalledProcessError:
                    continue
                archive = name + ".tar"
                run(["docker", "run", "--rm", "--network", "none", "--read-only",
                     "--security-opt", "no-new-privileges:true",
                     "-v", self.volume(name) + ":/data:ro", "-v", str(target) + ":/backup",
                     "--entrypoint", "tar", self.images["CADDY_IMAGE"], "-cf", "/backup/" + archive, "-C", "/data", "."])
                (target / archive).chmod(0o600)
                artifacts[archive] = sha256(target / archive)
                volumes.append(name)
            for name in SECRET_FILES:
                if (self.state / name).exists():
                    shutil.copyfile(self.state / name, target / name)
                    (target / name).chmod(0o600)
                    artifacts[name] = sha256(target / name)
            release = self.root / "current-release.json"
            if release.exists():
                shutil.copyfile(release, target / "release.json")
                artifacts["release.json"] = sha256(target / "release.json")
            manifest = {"format": 1, "project": self.project, "images": self.images, "volumes": volumes, "sha256": artifacts}
            private_file(target / "manifest.json", json.dumps(manifest, indent=2) + "\n")
        finally:
            self.compose("up", "-d", "--wait", "backend", "backend-tls")
        print(f"Cold backup completed: {target}")

    def restore(self, backup):
        if not self.project.startswith("think-wide-restore-"):
            raise ValueError("Restore requires a NEW think-wide-restore-* project; production is never overwritten")
        if self.root.exists():
            raise ValueError("Restore destination must not exist")
        if run(["docker", "ps", "-aq", "--filter", "label=com.docker.compose.project=" + self.project], capture=True).strip():
            raise ValueError("Restore project already has containers")
        backup = Path(backup).resolve()
        manifest = json.loads((backup / "manifest.json").read_text())
        if manifest["format"] != 1 or manifest["images"] != self.images:
            raise ValueError("Restore with the same pinned infrastructure version as the backup")
        if not {"data", "internal_tls"}.issubset(manifest["volumes"]) or not set(manifest["volumes"]).issubset(VOLUMES):
            raise ValueError("Unexpected backup volume set")
        allowed = {n + ".tar" for n in manifest["volumes"]} | set(SECRET_FILES) | {"release.json"}
        if not {"backend.env.local", "app.env.local", "admin.env.local"}.issubset(manifest["sha256"]):
            raise ValueError("Backup must include the instance and admin credentials")
        for name, digest in manifest["sha256"].items():
            if name not in allowed or (backup / name).is_symlink() or sha256(backup / name) != digest:
                raise ValueError("Backup integrity check failed")
        for name in manifest["volumes"]:
            if name + ".tar" not in manifest["sha256"]:
                raise ValueError("Missing volume checksum")
            if run(["docker", "volume", "ls", "-q", "--filter", "name=^" + self.volume(name) + "$"], capture=True).strip():
                raise ValueError("Restore volume already exists")
            with tarfile.open(backup / (name + ".tar")) as archive:
                for member in archive:
                    path = PurePosixPath(member.name)
                    if path.is_absolute() or ".." in path.parts or not (member.isfile() or member.isdir()):
                        raise ValueError("Unsafe backup archive member")
        self.initialize()
        for name in SECRET_FILES:
            if name in manifest["sha256"]:
                shutil.copyfile(backup / name, self.state / name)
                (self.state / name).chmod(0o600)
        # The restored credential targets the isolated restore listener, not production.
        admin = self.state / "admin.env.local"
        if admin.exists():
            values = env_file(admin)
            values["CONVEX_SELF_HOSTED_URL"] = f"http://127.0.0.1:{self.env['BACKEND_PORT']}"
            admin.write_text("".join(f"{k}={v}\n" for k, v in values.items()))
        self.check_environment()
        for name in manifest["volumes"]:
            run(["docker", "volume", "create", "--label", "com.docker.compose.project=" + self.project,
                 "--label", "com.docker.compose.volume=" + name, self.volume(name)], capture=True)
            run(["docker", "run", "--rm", "--network", "none", "--read-only",
                 "--security-opt", "no-new-privileges:true", "-v", self.volume(name) + ":/data",
                 "-v", str(backup) + ":/backup:ro", "--entrypoint", "tar", self.images["CADDY_IMAGE"],
                 "-xf", "/backup/" + name + ".tar", "-C", "/data"])
        # compose() ALWAYS applies the internal-network override for restore projects.
        print("Backup verified and restored into new volumes. Bootstrap this restore project to inspect without outbound network.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["initialize", "bootstrap", "backup", "restore", "check", "check-connected"])
    parser.add_argument("--root", default="/opt/think-wide")
    parser.add_argument("--project", default="think-wide-production")
    parser.add_argument("--backend-port", type=int, default=3210)
    parser.add_argument("--actions-port", type=int, default=3211)
    parser.add_argument("--backup")
    args = parser.parse_args()
    os.umask(0o077)
    installation = Installation(args.root, args.project, args.backend_port, args.actions_port)
    # Per-project advisory lock, outside the possibly new restore destination.
    lock_path = Path("/tmp") / (args.project + ".maintenance.lock")
    fd = os.open(lock_path, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if args.command == "restore":
        if not args.backup:
            parser.error("restore requires --backup")
        installation.restore(args.backup)
    elif args.command == "check-connected":
        installation.check_connected()
    elif args.command == "check":
        installation.check_environment()
        installation.compose("config", "--quiet")
    else:
        getattr(installation, args.command)()


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, TypeError, RuntimeError, OSError, http.client.HTTPException, subprocess.CalledProcessError) as error:
        # Never print captured provider output, environment values, or admin credentials.
        print(f"Deployment operation failed ({type(error).__name__}); inspect configuration privately.")
        raise SystemExit(1) from None
