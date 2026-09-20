#!/usr/bin/env bash
# Run locally in a clean, verified checkout. Output goes outside the git worktree.
set -euo pipefail
repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"
if [[ -n $(git status --porcelain) ]]; then
  echo 'Release builds require a clean committed checkout.' >&2
  exit 1
fi
release_commit=$(git rev-parse HEAD)
release_output=${1:?Usage: build-release.sh /absolute/output-directory}
[[ "$release_output" = /* && ! -e "$release_output" ]] || { echo 'Use a new absolute output directory.' >&2; exit 1; }
python3 - "${VITE_CONVEX_URL:-}" "${VITE_THINK_WIDE_IDENTITY:-workos}" <<'VALIDATE'
import sys
from urllib.parse import urlsplit
value = sys.argv[1]
if sys.argv[2] != 'workos':
    raise SystemExit('Production releases require VITE_THINK_WIDE_IDENTITY=workos')
if not value:
    raise SystemExit('Production releases require VITE_CONVEX_URL')
if value:
    parsed = urlsplit(value)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment or parsed.path not in ('', '/')
            or any(c.isspace() for c in value)):
        raise SystemExit('VITE_CONVEX_URL must be a public HTTPS origin without credentials')
VALIDATE
bun run verify
mkdir -m 700 -p "$release_output"
# This file contains reviewed public image references only, never credentials.
source infra/production/images.env
docker build --file infra/production/Dockerfile \
  --build-arg "NODE_IMAGE=$NODE_IMAGE" --build-arg "BUN_IMAGE=$BUN_IMAGE" \
  --build-arg "VITE_CONVEX_URL=${VITE_CONVEX_URL:-}" \
  --build-arg "VITE_THINK_WIDE_IDENTITY=${VITE_THINK_WIDE_IDENTITY:-workos}" \
  --build-arg "SOURCE_COMMIT=$release_commit" --iidfile "$release_output/image.id" .
release_image=$(cat "$release_output/image.id")
docker save --output "$release_output/app-image.tar" "$release_image"
python3 - "$release_output" "$release_commit" "$release_image" "${VITE_CONVEX_URL:-}" "${VITE_THINK_WIDE_IDENTITY:-workos}" <<'PY'
import hashlib, json, pathlib, sys
out = pathlib.Path(sys.argv[1])
with (out / 'app-image.tar').open('rb') as f:
    digest = hashlib.file_digest(f, 'sha256').hexdigest()
(out / 'release.json').write_text(json.dumps({
    'sourceCommit': sys.argv[2], 'appImage': sys.argv[3], 'archiveSha256': digest,
    'browserConvexUrl': sys.argv[4], 'browserIdentity': sys.argv[5], 'publicActivation': 'NOT_RUN',
}, indent=2) + '\n')
PY
printf 'Built verified commit %s as %s\n' "$release_commit" "$release_image"
