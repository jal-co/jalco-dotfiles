#!/usr/bin/env bash

set -eu

cat <<'EOF'

  HERDR SHORTCUTS

  Press Ctrl+B, release both keys, then press:

    T   New tab              R   Toggle diff review
    X   Close tab            I   Open agent timeline
    W   New workspace        F   Open file viewer

  Less common:

    Shift+X   Close pane
    Alt+W     Workspace picker
    ?         Full Herdr shortcut list

  You can also right-click tabs, panes, and workspaces.

  Press any key to close.
EOF

IFS= read -rsn 1 _
