#!/usr/bin/env bash
set -euo pipefail
before=${1:?usage: visual-diff.sh <before-tag> <after-tag> [outdir]  (live apps must show the after variant; run capture.sh <before-tag> first)}
after=${2:?after tag}
out=${3:-${TMPDIR:-/tmp}/mastra-ui-preview}
here=$(cd "$(dirname "$0")" && pwd)
TB=$HOME/.pi/agent/browser-testing/task-browser
SETTLE=${SETTLE:-6}
PORT=${REPORT_PORT:-5399}
THRESHOLD=${THRESHOLD:-0.1}
[[ -s $out/pages.tsv ]] || { echo "missing $out/pages.tsv: run capture.sh $before first" >&2; exit 1; }
mkdir -p "$out/diffs" "$out/shots"
rows=$(mktemp)
while IFS=$'\t' read -r app name url; do
  base="$out/shots/$before-$app-$name.png"
  [[ -f $base ]] || { echo "skip $app/$name: no baseline" >&2; continue; }
  "$TB" open "$url" >/dev/null 2>&1 || echo "warn: could not open $url" >&2; sleep "$SETTLE"
  "$TB" screenshot "$out/shots/$after-$app-$name.png" >/dev/null 2>&1
  res=$("$TB" diff screenshot --baseline "$base" -o "$out/diffs/$app-$name.png" -t "$THRESHOLD" 2>&1 || true)
  pct=$(printf '%s' "$res" | grep -oE '[0-9.]+% pixels differ' | grep -oE '^[0-9.]+' || echo "0")
  [[ -z $pct ]] && pct=0
  echo "$pct|$app|$name|$url" | tee -a "$rows"
done < "$out/pages.tsv"
{
  cat <<HTML
<!doctype html><meta charset=utf-8><title>UI diff $before vs $after</title>
<style>body{font:14px system-ui;background:#111;color:#eee;margin:16px}h2{margin:24px 0 4px}a{color:#8ab4ff}
.row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.row figure{margin:0}figcaption{opacity:.6;padding:4px 0}
img{width:100%;border:1px solid #333;display:block}.same{opacity:.5}.pct{color:#ff6b6b;font-weight:600}</style>
<h1>$before vs $after</h1>
HTML
  sort -t'|' -k1,1 -gr "$rows" | while IFS='|' read -r pct app name url; do
    cls=""; [[ $pct == 0 || $pct == 0.00 ]] && cls=same
    echo "<section class=$cls><h2>$app / $name <span class=pct>$pct% differ</span> <a href=\"$url\">live</a></h2><div class=row>"
    echo "<figure><figcaption>before</figcaption><a href=\"shots/$before-$app-$name.png\"><img loading=lazy src=\"shots/$before-$app-$name.png\"></a></figure>"
    echo "<figure><figcaption>diff (red = changed)</figcaption><a href=\"diffs/$app-$name.png\"><img loading=lazy src=\"diffs/$app-$name.png\"></a></figure>"
    echo "<figure><figcaption>after</figcaption><a href=\"shots/$after-$app-$name.png\"><img loading=lazy src=\"shots/$after-$app-$name.png\"></a></figure>"
    echo "</div></section>"
  done
} > "$out/report.html"
rm -f "$rows"
if ! curl -s -o /dev/null "http://127.0.0.1:$PORT/report.html"; then
  (cd "$out" && nohup python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 & echo $! > "$out/report-server.pid")
  sleep 1
fi
echo "report: http://127.0.0.1:$PORT/report.html"
[[ ${NO_OPEN:-0} = 1 ]] || "$TB" review "http://127.0.0.1:$PORT/report.html"
