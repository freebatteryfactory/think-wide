#!/usr/bin/env python3
"""Run production entrypoint refusals and a private container liveness probe."""
import argparse
import subprocess

from control import Installation, run


def smoke(image, root):
    install = Installation(root, "think-wide-production")
    cases = {
        "unset mode": {},
        "local-demo": {"THINK_WIDE_MODE": "local-demo"},
        "unisolated analyzer": {"THINK_WIDE_MODE": "connected", "THINKWIDE_ALLOW_UNISOLATED_ANALYZER": "1"},
        "local issuer": {"THINK_WIDE_MODE": "connected", "THINK_WIDE_LOCAL_JWKS": "synthetic-test-value"},
        "admin credential": {"THINK_WIDE_MODE": "connected", "CONVEX_SELF_HOSTED_ADMIN_KEY": "synthetic-test-value"},
        "disabled TLS verification": {"THINK_WIDE_MODE": "connected", "NODE_TLS_REJECT_UNAUTHORIZED": "0"},
    }
    for label, env in cases.items():
        args = ["docker", "run", "--rm", "--network", "none", "-e", "CONVEX_SELF_HOSTED_URL=https://convex.internal:8443"]
        for key, value in env.items():
            args += ["-e", f"{key}={value}"]
        result = subprocess.run([*args, image], capture_output=True, text=True, timeout=20)
        if result.returncode != 1 or "Think-Wide production configuration rejected" not in result.stderr:
            raise RuntimeError("Production refusal failed: " + label)
        print("PASS refused " + label)
    name = "think-wide-production-image-smoke"
    try:
        run(["docker", "run", "--name", name, "-d", "--network", "think-wide-production_private",
             "--read-only", "--tmpfs", "/tmp:size=64m,mode=1777", "--cap-drop", "ALL",
             "--security-opt", "no-new-privileges:true", "-e", "THINK_WIDE_MODE=connected",
             "-e", "CONVEX_SELF_HOSTED_URL=https://convex.internal:8443",
             "-e", "NODE_EXTRA_CA_CERTS=/ca.crt",
             "-v", str(install.state / "convex-root.crt") + ":/ca.crt:ro", image], capture=True)
        probe = """
        for (let attempt = 0; attempt < 20; attempt++) {
          try {
            const r = await fetch('http://127.0.0.1:3000/', {signal: AbortSignal.timeout(2000)});
            if (r.status !== 200) throw new Error('unexpected liveness response');
            const backend = await fetch('https://convex.internal:8443/version');
            if (!backend.ok) throw new Error('private TLS failed');
            console.log('PASS connected process liveness and private TLS; hosted identity NOT RUN');
            process.exit(0);
          } catch { await new Promise(resolve => setTimeout(resolve, 500)); }
        }
        process.exit(1);
        """
        run(["docker", "exec", name, "node", "--input-type=module", "-e", probe])
    finally:
        run(["docker", "rm", "-f", name], capture=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image")
    parser.add_argument("--root", default="/opt/think-wide")
    args = parser.parse_args()
    smoke(args.image, args.root)
