#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v pnpm >/dev/null 2>&1; then
    echo "pnpm is required to build the VSIX." >&2
    exit 1
fi

if ! command -v node >/dev/null 2>&1; then
    echo "Node.js is required to build the VSIX." >&2
    exit 1
fi

# Ensure dependencies are installed
pnpm install --frozen-lockfile

EXT_NAME="$(node -p "require('./package.json').name")"
EXT_VERSION="$(node -p "require('./package.json').version")"

OUTPUT_PATH="$ROOT_DIR/${EXT_NAME}-${EXT_VERSION}.vsix"

# Package the extension into a VSIX
pnpm exec vsce package --no-dependencies --out "$OUTPUT_PATH"

echo "VSIX created at $OUTPUT_PATH"
