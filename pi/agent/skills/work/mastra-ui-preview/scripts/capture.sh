#!/usr/bin/env bash
set -euo pipefail
tag=${1:?usage: capture.sh <tag> [outdir]}
out=${2:-${TMPDIR:-/tmp}/mastra-ui-preview}
here=$(cd "$(dirname "$0")" && pwd)
TB=$HOME/.pi/agent/browser-testing/task-browser
FACTORY_URL=${FACTORY_URL:-http://127.0.0.1:5173/factories/factory-1}
STUDIO_URL=${STUDIO_URL:-http://127.0.0.1:5290}
FACTORY_PAGES=${FACTORY_PAGES-work review overview activity audit rules attention knowledge settings/preferences}
STUDIO_PAGES=${STUDIO_PAGES-prompts settings resources agents scorers datasets}
SETTLE=${SETTLE:-6}
mkdir -p "$out/shots"
: > "$out/$tag.txt"
: > "$out/pages.tsv"
run() {
  app=$1; url=$2; name=$3
  printf '%s\t%s\t%s\n' "$app" "$name" "$url" >> "$out/pages.tsv"
  "$TB" open "$url" >/dev/null 2>&1 || echo "warn: could not open $url" >&2
  sleep "$SETTLE"
  probe=$("$TB" eval "$(cat "$here/probe.js")" 2>&1 | tail -1)
  echo "$tag|$app|$name|$probe" | tee -a "$out/$tag.txt"
  "$TB" screenshot "$out/shots/$tag-$app-$name.png" >/dev/null 2>&1
}
for p in $FACTORY_PAGES; do run factory "$FACTORY_URL/$p" "${p//\//-}"; done
for p in $STUDIO_PAGES; do run studio "$STUDIO_URL/$p" "$p"; done
