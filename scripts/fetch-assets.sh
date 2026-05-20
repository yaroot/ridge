#!/usr/bin/env bash
set -euo pipefail

ALPINE_VERSION="3.15.12"
MODERN_NORMALIZE_VERSION="3.0.1"

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
assets_dir="$repo_root/src/assets"
mkdir -p "$assets_dir"

fetch() {
  local url="$1" out="$2"
  echo "→ $out"
  curl -fsSL "$url" -o "$out.tmp"
  mv "$out.tmp" "$out"
}

# Drop any previous Alpine builds so we don't accumulate versions.
rm -f "$assets_dir"/alpine.*.min.js

fetch \
  "https://unpkg.com/alpinejs@${ALPINE_VERSION}/dist/cdn.min.js" \
  "$assets_dir/alpine.min.js"

fetch \
  "https://unpkg.com/modern-normalize@${MODERN_NORMALIZE_VERSION}/modern-normalize.css" \
  "$assets_dir/modern-normalize.css"

echo "done."
