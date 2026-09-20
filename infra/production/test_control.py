"""Filesystem and recovery rejection tests; no Docker daemon or credentials needed."""
import io
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
import threading
from unittest.mock import patch

import control


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.install = control.Installation(self.base / "production", "think-wide-production")
        self.install.initialize()
        control.private_file(self.install.state / "admin.env.local", "CONVEX_SELF_HOSTED_ADMIN_KEY=synthetic-test-key\n")

    def fixture(self):
        backup = self.base / "backup"
        backup.mkdir()
        for name in control.SECRET_FILES:
            (backup / name).write_bytes((self.install.state / name).read_bytes())
        for name in ("data", "internal_tls"):
            with tarfile.open(backup / (name + ".tar"), "w") as archive:
                member = tarfile.TarInfo("probe")
                member.size = 2
                archive.addfile(member, io.BytesIO(b"ok"))
        manifest = {"format": 1, "images": self.install.images, "volumes": ["data", "internal_tls"],
                    "sha256": {p.name: control.sha256(p) for p in backup.iterdir()}}
        (backup / "manifest.json").write_text(json.dumps(manifest))
        return backup, manifest

    def restore(self):
        return control.Installation(self.base / "restore", "think-wide-restore-test", 43210, 43211)

    def test_private_initialization_is_idempotent(self):
        before = (self.install.state / "backend.env.local").read_bytes()
        self.install.initialize()
        self.assertEqual(before, (self.install.state / "backend.env.local").read_bytes())
        self.assertEqual(0o600, (self.install.state / "backend.env.local").stat().st_mode & 0o777)

    def test_local_identity_and_admin_credentials_cannot_enter_app(self):
        for value in ("THINK_WIDE_MODE=local-demo", "THINK_WIDE_LOCAL_JWKS=x", "THINKWIDE_ALLOW_UNISOLATED_ANALYZER=1", "CONVEX_SELF_HOSTED_ADMIN_KEY=x", "INSTANCE_SECRET=x"):
            with self.subTest(value=value):
                (self.install.state / "app.env.local").write_text(value + "\n")
                with self.assertRaises(ValueError):
                    self.install.check_environment()

    def test_duplicate_env_rejected(self):
        path = self.base / "duplicate"
        path.write_text("MODE=a\nMODE=b\n")
        with self.assertRaises(ValueError):
            control.env_file(path)

    def test_restore_requires_different_ports(self):
        with self.assertRaises(ValueError):
            control.Installation(self.base / "restore", "think-wide-restore-test")

    @patch("control.run", return_value="")
    def test_restore_always_uses_isolated_network(self, run):
        self.restore().compose("up", "-d", "backend")
        self.assertIn(str(control.HERE / "compose.restore.yml"), run.call_args.args[0])

    @patch("control.run", return_value="")
    def test_restore_requires_original_credentials_before_mutating_destination(self, run):
        backup, manifest = self.fixture()
        del manifest["sha256"]["backend.env.local"]
        (backup / "manifest.json").write_text(json.dumps(manifest))
        restore = self.restore()
        with self.assertRaises(ValueError):
            restore.restore(backup)
        self.assertFalse(restore.root.exists())

    @patch("control.run", return_value="")
    def test_tampered_backup_rejected_before_mutation(self, run):
        backup, _ = self.fixture()
        (backup / "data.tar").write_bytes(b"tampered")
        restore = self.restore()
        with self.assertRaises(ValueError):
            restore.restore(backup)
        self.assertFalse(restore.root.exists())

    @patch("control.run", return_value="")
    def test_archive_traversal_rejected_even_with_matching_checksum(self, run):
        backup, manifest = self.fixture()
        with tarfile.open(backup / "data.tar", "w") as archive:
            member = tarfile.TarInfo("../escape")
            archive.addfile(member, io.BytesIO(b""))
        manifest["sha256"]["data.tar"] = control.sha256(backup / "data.tar")
        (backup / "manifest.json").write_text(json.dumps(manifest))
        restore = self.restore()
        with self.assertRaises(ValueError):
            restore.restore(backup)
        self.assertFalse(restore.root.exists())

    def test_existing_destination_never_overwritten(self):
        restore = self.restore()
        restore.root.mkdir()
        with self.assertRaises(ValueError):
            restore.restore(self.base / "absent")

    def test_symlink_secret_rejected(self):
        path = self.install.state / "app.env.local"
        path.unlink()
        path.symlink_to(self.install.state / "backend.env.local")
        with self.assertRaises(ValueError):
            self.install.check_environment()

    @patch("control.run", return_value="")
    def test_partial_stop_failure_still_restarts_services(self, run):
        def compose(*args, **kwargs):
            if args[0] == "stop":
                raise OSError("simulated Docker failure")
            return ""
        with patch.object(self.install, "owned_volume"), patch.object(self.install, "compose", side_effect=compose) as calls:
            with self.assertRaises(OSError):
                self.install.backup()
        self.assertEqual(("up", "-d", "--wait", "backend", "backend-tls"), calls.call_args.args)


class ConnectedTests(unittest.TestCase):
    """Exercise the operator's HTTP boundary with a local protocol fixture."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.requests = []
        self.status = 200
        self.result = {"status": "success", "value": [
            {"name": "THINK_WIDE_MODE", "value": "connected"},
            {"name": "WORKOS_CLIENT_ID", "value": "client_fixture"},
        ]}
        test = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                test.requests.append((self.path, self.headers.get("Authorization"),
                                      json.loads(self.rfile.read(int(self.headers["Content-Length"])))))
                self.send_response(test.status)
                if test.status == 302:
                    self.send_header("Location", "https://example.com/steal")
                self.end_headers()
                self.wfile.write(json.dumps(test.result).encode())

            def log_message(self, *args):
                pass

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(thread.join)
        self.addCleanup(self.server.shutdown)
        self.port = self.server.server_port
        self.install = control.Installation(Path(self.temp.name) / "production", "think-wide-production",
                                            self.port, 43212 if self.port != 43212 else 43213)
        self.install.initialize()
        control.private_file(self.install.state / "admin.env.local",
                             f"CONVEX_SELF_HOSTED_URL=http://127.0.0.1:{self.port}\nCONVEX_SELF_HOSTED_ADMIN_KEY=synthetic-key\n")
        (self.install.state / "app.env.local").write_text(
            "WORKOS_API_KEY=synthetic-api-key\nWORKOS_CLIENT_ID=client_fixture\n"
            "WORKOS_COOKIE_PASSWORD=" + "x" * 32 + "\n"
            "WORKOS_REDIRECT_URI=https://think-wide.fbf.systems/api/auth/callback\nTHINK_WIDE_IDENTITY=workos\n")

    def test_queries_actual_deployment_environment_without_mutations(self):
        self.install.check_connected()
        self.assertEqual(self.requests, [("/api/query", "Convex synthetic-key", {
            "path": "_system/cli/queryEnvironmentVariables", "args": {}, "format": "json"})])

    def test_missing_or_development_deployment_mode_is_rejected(self):
        for value in (None, "", "local-demo", "production"):
            with self.subTest(value=value):
                self.result["value"] = [{"name": "WORKOS_CLIENT_ID", "value": "client_fixture"}]
                if value is not None:
                    self.result["value"].append({"name": "THINK_WIDE_MODE", "value": value})
                with self.assertRaises(ValueError):
                    self.install.check_connected()

    def test_missing_or_mismatched_deployment_client_is_rejected(self):
        for value in (None, "", "client_other"):
            with self.subTest(value=value):
                self.result["value"] = [{"name": "THINK_WIDE_MODE", "value": "connected"}]
                if value is not None:
                    self.result["value"].append({"name": "WORKOS_CLIENT_ID", "value": value})
                with self.assertRaises(ValueError):
                    self.install.check_connected()

    def test_even_empty_local_jwks_or_analyzer_switch_is_rejected(self):
        for name in control.FORBIDDEN:
            with self.subTest(name=name):
                self.result["value"].append({"name": name, "value": ""})
                with self.assertRaises(ValueError):
                    self.install.check_connected()
                self.result["value"].pop()

    def test_redirect_never_forwards_admin_credential(self):
        self.status = 302
        with self.assertRaises(RuntimeError):
            self.install.check_connected()
        self.assertEqual(len(self.requests), 1)

    def test_remote_or_wrong_loopback_endpoint_is_rejected_before_network(self):
        for origin in ("http://localhost:3210", "http://example.com", "https://127.0.0.1", "http://127.0.0.1:1"):
            with self.subTest(origin=origin):
                (self.install.state / "admin.env.local").write_text(
                    f"CONVEX_SELF_HOSTED_URL={origin}\nCONVEX_SELF_HOSTED_ADMIN_KEY=synthetic-key\n")
                with self.assertRaises(ValueError):
                    self.install.check_connected()
        self.assertEqual(self.requests, [])

    def test_failure_and_malformed_environment_fail_closed(self):
        for value in ({"status": "error", "errorMessage": "private-provider-output"},
                      {"status": "success", "value": {}},
                      {"status": "success", "value": [{"name": "WORKOS_CLIENT_ID", "value": 5}]},
                      {"status": "success", "value": self.result["value"] * 2}):
            with self.subTest(value=value):
                self.result = value
                with self.assertRaises(RuntimeError) as error:
                    self.install.check_connected()
                self.assertNotIn("private-provider-output", str(error.exception))

    def test_incomplete_app_credentials_are_rejected_before_network(self):
        (self.install.state / "app.env.local").write_text((control.HERE / "app.env.template").read_text())
        with self.assertRaises(ValueError):
            self.install.check_connected()
        self.assertEqual(self.requests, [])

    def test_public_configuration_leaves_dashboard_private(self):
        compose = (control.HERE / "compose.public.yml").read_text()
        self.assertIn("networks: [edge, private]", compose)
        self.assertNotIn("6791", compose)
        caddy = (control.HERE / "Caddyfile").read_text()
        self.assertIn("reverse_proxy backend:3210", caddy)
        self.assertNotIn("dashboard:", caddy)
        self.assertIn("connect-src 'self' https://convex.think-wide.fbf.systems wss://convex.think-wide.fbf.systems", caddy)


if __name__ == "__main__":
    unittest.main()
