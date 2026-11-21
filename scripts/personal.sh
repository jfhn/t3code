#!/usr/bin/env bash
# Personal fork helper. The official T3 Code app keeps running the server and owns ~/.t3;
# this fork only supplies a web client that talks to that server.
#
#   scripts/personal.sh web    serve the fork's web UI on http://localhost:5733
#   scripts/personal.sh sync   move the fork's commits onto the release the official app runs
set -euo pipefail

runtime="$HOME/.t3/userdata/server-runtime.json"
[[ -f "$runtime" ]] || { echo "No official server state at $runtime; start the T3 Code app first." >&2; exit 1; }
port=$(jq -r .port "$runtime")
tag="v$(jq -r .serverVersion "$runtime")"
cd "$(dirname "$0")/.."

case "${1:-}" in
  web)
    # The web client must not be newer than the server, or it may call RPCs the server lacks.
    base=$(git describe --tags --abbrev=0 --match 'v*' HEAD)
    if [[ "$(git rev-parse -q --verify "$tag^{commit}" || true)" != "$(git rev-parse "$base^{commit}")" ]]; then
      echo "warning: fork is based on $base but the app runs $tag; run '$0 sync'." >&2
    fi
    exec vp run dev:web --port "$port"
    ;;
  sync)
    old=$(git describe --tags --abbrev=0 --match 'v*' HEAD)
    git fetch -q upstream tag "$tag" --no-tags
    if [[ "$(git rev-parse "$tag^{commit}")" == "$(git rev-parse "$old^{commit}")" ]]; then
      echo "Already on $tag."
      exit 0
    fi
    git rebase --onto "$tag" "$old"
    vp i
    git checkout -- pnpm-lock.yaml
    echo "Rebased from $old onto $tag. Push with: git push --force-with-lease origin HEAD"
    ;;
  *)
    echo "usage: $0 web|sync" >&2
    exit 2
    ;;
esac
