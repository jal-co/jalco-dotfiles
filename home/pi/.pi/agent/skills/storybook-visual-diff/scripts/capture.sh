#!/bin/bash
set -u
BASE=$1 BRANCH=$2 IDS=$3 OUT=$4 THEME=$5 SHARDS=${6:-6} THRESHOLD=${7:-0.02}
TB=~/.pi/agent/browser-testing/task-browser
S=$OUT/shots
mkdir -p "$S"

curl -s "$BASE/index.json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(Object.keys(JSON.parse(s).entries).join("\n")))' > "$OUT/.base-ids-$THEME"

dims() { sips -g pixelWidth -g pixelHeight "$1" 2>/dev/null | awk '/pixel/{printf $2" "}'; }

run_shard() {
  local k=$1 ses="task-ui-vdiff-$THEME-$1" out="$OUT/.shard-$THEME-$1.tsv"
  : > "$out"
  $TB --session "$ses" set viewport 1280 800 2 >/dev/null 2>&1
  awk -v n="$SHARDS" -v k="$k" 'NF && (NR-1)%n==k' "$IDS" | while read -r id; do
    local q="id=$id&viewMode=story&globals=theme:$THEME" b="$S/b-$THEME-$id.png" a="$S/a-$THEME-$id.png" d="$S/d-$THEME-$id.png"
    if ! grep -qx "$id" "$OUT/.base-ids-$THEME"; then
      $TB --session "$ses" open "$BRANCH/iframe.html?$q" >/dev/null 2>&1
      $TB --session "$ses" wait --load networkidle >/dev/null 2>&1; sleep 0.3
      $TB --session "$ses" screenshot '#storybook-root' "$a" >/dev/null 2>&1 || $TB --session "$ses" screenshot "$a" >/dev/null 2>&1
      printf '%s\tnew\t100\n' "$id" >> "$out"; continue
    fi
    $TB --session "$ses" open "$BASE/iframe.html?$q" >/dev/null 2>&1
    $TB --session "$ses" wait --load networkidle >/dev/null 2>&1; sleep 0.3
    local sel='#storybook-root'
    if ! $TB --session "$ses" screenshot "$sel" "$b" >/dev/null 2>&1; then
      sel=''
      $TB --session "$ses" screenshot "$b" >/dev/null 2>&1 || { printf '%s\tbase-error\t0\n' "$id" >> "$out"; continue; }
    fi
    $TB --session "$ses" open "$BRANCH/iframe.html?$q" >/dev/null 2>&1
    $TB --session "$ses" wait --load networkidle >/dev/null 2>&1; sleep 0.3
    if ! $TB --session "$ses" screenshot $sel "$a" >/dev/null 2>&1; then printf '%s\tbranch-error\t0\n' "$id" >> "$out"; continue; fi
    if [ "$(dims "$b")" != "$(dims "$a")" ]; then printf '%s\tsize\t100\n' "$id" >> "$out"; continue; fi
    local r pct
    r=$($TB --session "$ses" diff screenshot ${sel:+--selector "$sel"} --baseline "$b" --output "$d" --threshold "$THRESHOLD" 2>&1)
    pct=$(printf '%s' "$r" | grep -oE '[0-9.]+% pixels differ' | grep -oE '^[0-9.]+' || true)
    printf '%s\tpixels\t%s\n' "$id" "${pct:-0}" >> "$out"
  done
  $TB --session "$ses" close >/dev/null 2>&1
}

for k in $(seq 0 $((SHARDS - 1))); do run_shard "$k" & done
wait
cat "$OUT"/.shard-"$THEME"-*.tsv > "$OUT/results-$THEME.tsv"
rm -f "$OUT"/.shard-"$THEME"-*.tsv "$OUT/.base-ids-$THEME"
awk -F'\t' '$3>0{c++} $2~/error/{e++} END{printf "%d stories, %d changed, %d errors\n", NR, c, e}' "$OUT/results-$THEME.tsv"
