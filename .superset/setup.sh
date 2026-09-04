#!/bin/sh
set -eu

if [ -f "$SUPERSET_ROOT_PATH/.jdotignore" ]; then
  cp "$SUPERSET_ROOT_PATH/.jdotignore" "$SUPERSET_WORKSPACE_PATH/.jdotignore"
fi

git ls-files '*package.json' | while IFS= read -r manifest; do
  directory=${manifest%/package.json}
  root_directory="$SUPERSET_ROOT_PATH/$directory"
  workspace_directory="$SUPERSET_WORKSPACE_PATH/$directory"

  if [ -e "$workspace_directory/node_modules" ] || [ -L "$workspace_directory/node_modules" ]; then
    continue
  fi

  if [ -d "$root_directory/node_modules" ]; then
    cp -cR "$root_directory/node_modules" "$workspace_directory/node_modules"
  elif [ -f "$root_directory/package-lock.json" ]; then
    cp "$root_directory/package-lock.json" "$workspace_directory/package-lock.json"
    npm ci --prefix "$workspace_directory"
  else
    npm install --no-package-lock --prefix "$workspace_directory"
  fi
done
