"""Filesystem and recovery rejection tests; no Docker daemon or credentials needed."""
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
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


if __name__ == "__main__":
    unittest.main()
