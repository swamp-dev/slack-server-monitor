#!/usr/bin/env bash
# Builds the agentbox Go binary from the vendor/agentbox submodule into
# dist/bin/agentbox. This is the single source of truth for both local
# development (`npm run agentbox:build`) and the Dockerfile builder stage.
#
# Skips silently with a friendly note if Go isn't installed — fresh clones
# don't need Go to run the rest of the project.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SUBMODULE_DIR="$REPO_ROOT/vendor/agentbox"
OUT_DIR="$REPO_ROOT/dist/bin"
OUT_BIN="$OUT_DIR/agentbox"

if ! command -v go >/dev/null 2>&1; then
  echo "[agentbox] Go is not on PATH; skipping build."
  echo "[agentbox] Install Go 1.24+ to build the binary locally, or rely on the Docker build."
  exit 0
fi

if [ ! -d "$SUBMODULE_DIR" ] || [ -z "$(ls -A "$SUBMODULE_DIR" 2>/dev/null)" ]; then
  echo "[agentbox] vendor/agentbox is empty — did you forget 'git submodule update --init --recursive'?"
  exit 1
fi

mkdir -p "$OUT_DIR"

cd "$SUBMODULE_DIR"
go build -o "$OUT_BIN" ./cmd/agentbox

echo "[agentbox] Built $OUT_BIN ($(du -h "$OUT_BIN" | cut -f1))"
