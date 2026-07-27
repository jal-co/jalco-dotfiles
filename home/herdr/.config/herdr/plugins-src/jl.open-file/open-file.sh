#!/usr/bin/env bash
#
# Opens a clicked path:line reference in a GUI editor.
#
# Herdr sets HERDR_PLUGIN_CLICKED_URL to the matched text and HERDR_PANE_ID to
# the pane it came from. The match is usually relative, so it only resolves
# against the cwd of that pane, not the cwd of this script.
#
# Actions run without a TTY, so a terminal editor would hang here with no way
# to reach it. Override the editor with HERDR_LINK_EDITOR if you want zed.

set -euo pipefail

match="${HERDR_PLUGIN_CLICKED_URL:-}"
[[ -n $match ]] || { echo "no clicked text" >&2; exit 1; }

# Split trailing :line or :line:column off the path.
path="${match%%:*}"
rest="${match#*:}"
line="${rest%%:*}"
[[ $line =~ ^[0-9]+$ ]] || line=1

# Resolve a relative path against the pane's foreground cwd.
if [[ $path != /* ]]; then
	pane="${HERDR_PANE_ID:-}"
	if [[ -n $pane ]]; then
		cwd=$(herdr pane get "$pane" 2>/dev/null |
			python3 -c 'import json,sys
try:
    p = json.load(sys.stdin)["result"]["pane"]
    print(p.get("foreground_cwd") or p.get("cwd") or "")
except Exception:
    print("")' 2>/dev/null || true)
		[[ -n ${cwd:-} ]] && path="$cwd/$path"
	fi
fi

[[ -e $path ]] || { echo "not a file: $path" >&2; exit 1; }

editor="${HERDR_LINK_EDITOR:-}"
if [[ -z $editor ]]; then
	if command -v code >/dev/null 2>&1; then
		editor=code
	elif command -v zed >/dev/null 2>&1; then
		editor=zed
	else
		echo "no GUI editor found; set HERDR_LINK_EDITOR" >&2
		exit 1
	fi
fi

case $editor in
code) exec code -g "$path:$line" ;;
zed) exec zed "$path:$line" ;;
*) exec "$editor" "$path" ;;
esac
