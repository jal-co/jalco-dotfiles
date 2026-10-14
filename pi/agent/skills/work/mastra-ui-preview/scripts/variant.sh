#!/usr/bin/env bash
set -euo pipefail
cmd=${1:?usage: variant.sh <main|branch|status> [files...]  (run from the mastra worktree root)}
shift || true
root=$(git rev-parse --show-toplevel)
cd "$root"
save=${UI_PREVIEW_SAVE:-${TMPDIR:-/tmp}/ui-preview-saved/$(basename "$root")}
ref=${REF:-origin/main}
sync() {
  [[ ${NOBUILD:-0} = 1 ]] && return
  pnpm --filter ./packages/playground-ui build >"${TMPDIR:-/tmp}/ui-preview-build.log" 2>&1 || { tail -20 "${TMPDIR:-/tmp}/ui-preview-build.log"; exit 1; }
  [[ -d ${PLATFORM_FRONTEND:-} ]] && "$(dirname "$0")/pui-link.sh" sync "$root" "$PLATFORM_FRONTEND"
  return 0
}
case $cmd in
  main)
    [[ $# -gt 0 ]] || { echo "pass the files to revert to $ref" >&2; exit 2; }
    for f in "$@"; do
      mkdir -p "$save/$(dirname "$f")"
      [[ -e $save/$f ]] || cp "$f" "$save/$f"
      git show "$ref:$f" > "$f"
    done
    sync; echo "now showing $ref for: $*" ;;
  branch)
    [[ -d $save ]] || { echo "nothing saved"; exit 0; }
    (cd "$save" && find . -type f) | sed 's|^\./||' | while read -r f; do cp "$save/$f" "$f"; done
    rm -rf "$save"; sync; echo "branch restored" ;;
  status)
    [[ -d $save ]] && (cd "$save" && find . -type f) || echo "branch is live (nothing swapped)" ;;
esac
