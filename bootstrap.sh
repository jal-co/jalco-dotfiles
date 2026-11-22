#!/bin/sh
# bootstrap.sh: set up this machine from jalco-dotfiles (macOS or Linux)
set -eu
cd "$(dirname "$0")"
command -v mise >/dev/null 2>&1 || curl -fsSL https://mise.run | sh
export PATH="$HOME/.local/bin:$PATH"
export MISE_AUTO_ENV=true
case "$(uname -s)" in
  Darwin) os=macos ;;
  Linux)  os=linux ;;
  *) echo "unsupported OS" >&2; exit 1 ;;
esac
echo "bootstrapping for $os: mise.toml + mise.$os.toml"
mise trust
mise config
mise bootstrap --dry-run
printf 'Apply? [y/N] '; read -r answer
[ "$answer" = y ] && mise bootstrap
