#!/usr/bin/env python3
"""Verify and load a private release artifact. Does not start or publish an app."""
import argparse
import json
from pathlib import Path
import re
import shutil

from control import Installation, private_file, run, sha256


def stage(directory, root):
    directory = Path(directory).resolve()
    manifest = json.loads((directory / "release.json").read_text())
    commit, image = manifest["sourceCommit"], manifest["appImage"]
    if not re.fullmatch(r"[a-f0-9]{40}", commit) or not re.fullmatch(r"sha256:[a-f0-9]{64}", image):
        raise ValueError("Invalid immutable release identity")
    if sha256(directory / "app-image.tar") != manifest["archiveSha256"]:
        raise ValueError("Release archive checksum mismatch")
    installation = Installation(root, "think-wide-production")
    installation.check_environment()
    target = installation.root / "releases" / commit
    if target.exists():
        raise ValueError("Release already staged; never overwrite release artifacts")
    # Treat the archive as trusted operator input, delivered through authenticated SSH.
    # A checksum detects corruption; it is not a substitute for reviewing the commit.
    run(["docker", "load", "-i", str(directory / "app-image.tar")], capture=True)
    info = json.loads(run(["docker", "image", "inspect", image], capture=True))[0]
    if info["Id"] != image or info["Config"]["Labels"].get("org.opencontainers.image.revision") != commit:
        raise ValueError("Loaded image does not match the verified commit")
    if info["Config"].get("User") != "node":
        raise ValueError("Application must run as the unprivileged node user")
    target.mkdir(mode=0o700)
    shutil.copyfile(directory / "app-image.tar", target / "app-image.tar")
    (target / "app-image.tar").chmod(0o600)
    private_file(target / "release.json", json.dumps(manifest, indent=2) + "\n")
    print(f"Staged commit {commit} as {image}; public activation NOT RUN.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory")
    parser.add_argument("--root", default="/opt/think-wide")
    args = parser.parse_args()
    stage(args.directory, args.root)
