#!/bin/bash
set -u
PAGES=$1 OUT=$2 THEME=$3 SHARDS=${4:-4} THRESHOLD=${5:-0.02}
S=$OUT/shots
mkdir -p "$S"
export AGENT_BROWSER_NAMESPACE=pi-headless AGENT_BROWSER_HEADED=false AGENT_BROWSER_AUTO_CONNECT=false

dims() { sips -g pixelWidth -g pixelHeight "$1" 2>/dev/null | awk '/pixel/{printf $2" "}'; }

shoot() {
  local ses=$1 url=$2 file=$3
  agent-browser --session "$ses" open "$url" >/dev/null 2>&1
  agent-browser --session "$ses" wait --load networkidle >/dev/null 2>&1
  sleep 2
  agent-browser --session "$ses" screenshot "$file" >/dev/null 2>&1
}

run_shard() {
  local k=$1 ses="task-ui-vdiff-pages-$THEME-$1" out="$OUT/.shard-$THEME-$1.tsv"
  : > "$out"
  if [ -n "${VDIFF_STATE:-}" ]; then
    agent-browser --session "$ses" --state "$VDIFF_STATE" open about:blank >/dev/null 2>&1
  else
    agent-browser --session "$ses" open about:blank >/dev/null 2>&1
  fi
  agent-browser --session "$ses" set viewport 1440 900 2 >/dev/null 2>&1
  agent-browser --session "$ses" set media "$THEME" >/dev/null 2>&1
  awk -F'\t' -v n="$SHARDS" -v k="$k" 'NF>=3 && (NR-1)%n==k' "$PAGES" | while IFS=$'\t' read -r id base branch; do
    local b="$S/b-$THEME-$id.png" a="$S/a-$THEME-$id.png" d="$S/d-$THEME-$id.png"
    shoot "$ses" "$base" "$b" || true
    shoot "$ses" "$branch" "$a" || true
    if [ ! -s "$b" ] || [ ! -s "$a" ]; then printf '%s\tbase-error\t0\n' "$id" >> "$out"; continue; fi
    if [ "$(dims "$b")" != "$(dims "$a")" ]; then printf '%s\tsize\t100\n' "$id" >> "$out"; continue; fi
    local r pct
    r=$(agent-browser --session "$ses" diff screenshot --baseline "$b" --output "$d" --threshold "$THRESHOLD" 2>&1)
    pct=$(printf '%s' "$r" | grep -oE '[0-9.]+% pixels differ' | grep -oE '^[0-9.]+' || true)
    printf '%s\tpixels\t%s\n' "$id" "${pct:-0}" >> "$out"
  done
  agent-browser --session "$ses" close >/dev/null 2>&1
}

for k in $(seq 0 $((SHARDS - 1))); do run_shard "$k" & done
wait
cat "$OUT"/.shard-"$THEME"-*.tsv > "$OUT/results-$THEME.tsv"
rm -f "$OUT"/.shard-"$THEME"-*.tsv
awk -F'\t' '$3>0{c++} $2~/error/{e++} END{printf "%d pages, %d changed, %d errors\n", NR, c, e}' "$OUT/results-$THEME.tsv"
