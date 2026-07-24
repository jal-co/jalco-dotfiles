# jalco-dotfiles

Personal dev environment: shell, editors, terminal, git, and [pi](https://github.com/badlogic/pi-mono) agent config, managed with [GNU Stow](https://www.gnu.org/software/stow/) and a small CLI (`jdot`). [git-crypt](https://github.com/AGWA/git-crypt) encrypts private files, so this repo can be cloned anywhere without exposing secrets.

Layout inspired by [dmmulroy/.dotfiles](https://github.com/dmmulroy/.dotfiles) — packages live under `home/`, which mirrors `$HOME`, and a repo-root CLI handles stowing, Homebrew, and maintenance.

## Quick Start

```bash
git clone https://github.com/jal-co/jalco-dotfiles.git ~/dotfiles
cd ~/dotfiles
brew bundle --file=packages/bundle
./jdot stow
```

Re-stow after editing anything under `home/`:

```bash
./jdot stow
```

## Structure

```
dotfiles/
├── jdot                # CLI: stow/unstow/alias/doctor/benchmark-shell/digest/pi-digest
├── folders.toml         # Folder jump aliases + macOS Finder aliases
├── .jdotignore.example  # Template for machine-local package/glob opt-outs
├── AGENTS.md             # Conventions for generic coding agents working in this repo
├── DOTFILES.md            # Auto-generated repo digest (run `jdot digest`)
├── packages/
│   └── bundle            # Brewfile (taps, formulae, casks, npm globals)
└── home/                  # Mirrors $HOME — every subfolder here is a stow package
    ├── agents/.agents/     # Skills shared across coding agents (skills.sh managed)
    ├── claude/.claude/     # Claude Code agent definitions and commands
    ├── eza/.config/eza/
    ├── fastfetch/.config/fastfetch/
    ├── ghostty/.config/ghostty/
    ├── git/.config/git/
    ├── herdr/.config/herdr/
    ├── mise/.config/mise/    # Global tool versions (node, python, go, java)
    ├── pi/.pi/                # pi agent config: settings, skills, extensions, MCP
    ├── starship/.config/
    ├── tmux/.config/tmux/      # Plugins gitignored, reinstall via prefix + I
    ├── vscode/Library/Application Support/Code/User/
    ├── zed/.config/zed/
    └── zsh/                    # .zshrc, .zshrc.local (encrypted)
```

## `jdot` commands

| Command | Does |
|---|---|
| `jdot stow` | Stow every package in `home/` (skips names listed in `.jdotignore`) |
| `jdot unstow [pkg]` | Unstow one package, or everything |
| `jdot alias` | Regenerate shell aliases + macOS Finder aliases from `folders.toml` |
| `jdot doctor` | Report broken symlinks under `$HOME` |
| `jdot benchmark-shell [-r N] [-v]` | Benchmark zsh startup time |
| `jdot digest` | Regenerate `DOTFILES.md` (repo structure digest, never touches `AGENTS.md`) |
| `jdot pi-digest` | Regenerate `home/pi/PI.md` (skills/extensions/packages inventory) |

## Machine-local opt-outs

Copy `.jdotignore.example` to `.jdotignore` (gitignored) to skip stowing specific packages or files on a given machine:

```
# skip a whole package
vscode

# skip a file pattern in any package (e.g. submodule docs)
*/README.md
```

## Folder aliases

`folders.toml` defines both shell `cd` aliases and real macOS Finder shortcut files. Run `jdot alias` after editing it.

## pi

`home/pi/.pi/agent/` is a full pi config: settings, MCP servers, skills, and single-file/multi-file extensions. Three skills (`write-like-justin`, `job-search`, `real-app`) contain PII and are gitignored — they exist locally but are never committed. See `home/pi/PI.md` for the current skill/extension/package inventory (regenerate with `jdot pi-digest`).

## What's Ignored

Secrets (`auth.json`), runtime state (sessions, caches, `.zshrc.local` when locked), `node_modules/`, compiled binaries, tmux plugins (TPM-managed), and the three PII skills under `pi/`. See [`.gitignore`](.gitignore).

## Acknowledgments

- [GNU Stow](https://www.gnu.org/software/stow/)
- [git-crypt](https://github.com/AGWA/git-crypt)
- [dmmulroy/.dotfiles](https://github.com/dmmulroy/.dotfiles) — structural inspiration for `home/` + CLI
- [pi](https://github.com/badlogic/pi-mono) by [badlogic](https://github.com/badlogic)
