#!/usr/bin/env bash
set -euo pipefail
cmd=${1:?usage: pui-link.sh <in|sync|out|status> <mastra-worktree> <platform-frontend-dir>}
mastra=$(cd "${2:?mastra worktree}" && pwd)
fe=$(cd "${3:?platform frontend dir}" && pwd)
link=$fe/node_modules/@mastra/playground-ui
pnpmdir=$(cd "$fe/node_modules/.." && pwd)/../node_modules/.pnpm
pnpmdir=$(cd "$pnpmdir" && pwd)
copy=$pnpmdir/pui-local-copy
orig=$fe/node_modules/.pui-original-target
overlay() {
  local p=$copy/node_modules/@mastra/playground-ui
  rm -rf "$p/dist"
  cp -R "$mastra/packages/playground-ui/dist" "$p/dist"
  for f in theme theme.css package.json; do [[ -e $mastra/packages/playground-ui/$f ]] && { rm -rf "$p/$f"; cp -R "$mastra/packages/playground-ui/$f" "$p/$f"; }; done
  rm -rf "$fe/node_modules/.vite"
}
case $cmd in
  in)
    [[ -f $orig ]] && { echo "already linked in"; exit 0; }
    [[ -L $link ]] || { echo "$link is not a pnpm symlink" >&2; exit 1; }
    readlink "$link" > "$orig"
    src=$(cd "$(dirname "$link")" && cd "$(readlink "$link")/../../.." && pwd)
    rm -rf "$copy"; cp -R "$src" "$copy"
    overlay
    ln -sfn "../../../node_modules/.pnpm/pui-local-copy/node_modules/@mastra/playground-ui" "$link"
    echo "platform now uses $mastra/packages/playground-ui; restart vite with --force" ;;
  sync) [[ -f $orig ]] || { echo "not linked in" >&2; exit 1; }; overlay; echo "dist copied; vite picks it up on reload (restart with --force if not)" ;;
  out)
    [[ -f $orig ]] || { echo "not linked in"; exit 0; }
    ln -sfn "$(cat "$orig")" "$link"; rm -f "$orig"; rm -rf "$copy" "$fe/node_modules/.vite"
    echo "published package restored" ;;
  status) [[ -f $orig ]] && echo "LOCAL playground-ui linked in" || echo "published package" ;;
esac
