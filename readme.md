# jalco-dotfiles

Personal macOS configuration for shells, editors, terminals, Git, and [Pi](https://github.com/badlogic/pi-mono). [GNU Stow](https://www.gnu.org/software/stow/) links packages from `home/` into `$HOME`; `jdot` handles maintenance.

## Setup

Install Homebrew first, then review `packages/bundle`. It includes personal desktop apps, Mac App Store apps, and developer tools.

```bash
git clone https://github.com/jal-co/jalco-dotfiles.git ~/dotfiles
cd ~/dotfiles
brew bundle --file=packages/bundle
./jdot stow
```

`jdot` requires Node.js. Stowing requires GNU Stow. The Brewfile installs Pi globally; skill checks and the Pi inventory also require npm.

Existing files can conflict with Stow. Inspect conflicts and preserve local data before replacing anything. Re-run `./jdot stow` after adding or moving package files. Editing a file through an existing Stow symlink edits its repository target directly.

## Layout

```text
dotfiles/
├── jdot
├── folders.toml
├── .jdotignore.example
├── DOTFILES.md
├── packages/bundle
└── home/
    ├── agents/.agents/
    ├── eza/.config/eza/
    ├── fastfetch/.config/fastfetch/
    ├── ghostty/.config/ghostty/
    ├── git/.config/git/
    ├── herdr/.config/herdr/
    ├── mise/.config/mise/
    ├── pi/.pi/
    ├── starship/.config/
    ├── tmux/.config/tmux/
    ├── vscode/Library/Application Support/Code/User/
    ├── zed/.config/zed/
    └── zsh/
```

Each direct child of `home/` is a Stow package. OpenCode configuration is no longer managed here. Agent rules live in `home/pi/.pi/agent/AGENTS.md`.

## Commands

Run commands from the repository root.

| Command | Purpose |
| --- | --- |
| `./jdot stow` | Stow all packages except package names in `.jdotignore` |
| `./jdot unstow [pkg]` | Remove Stow links for one package, or all packages when omitted |
| `./jdot alias` | Generate shell shortcuts and macOS Finder aliases from `folders.toml` |
| `./jdot doctor` | Check mapped home paths for visible package entries; currently skips dot-prefixed entries |
| `./jdot benchmark-shell [-r N] [-v]` | Measure interactive Zsh startup |
| `./jdot digest` | Regenerate `DOTFILES.md` from the local repository |
| `./jdot pi-digest` | Regenerate `home/pi/PI.md`, including skills from both repository roots |
| `./jdot skills-check` | Check skill names, divergent copies, broken links, and Pi validation diagnostics without changing files |

`skills-check` exits nonzero on problems. It uses the globally installed Pi loader and checks repository skill roots, not package-provided skills or other projects.

`doctor` is not a complete dotfile audit. Use `skills-check` for skills and Stow's dry run to inspect link changes:

```bash
stow -n -v -d home -t "$HOME" pi agents
```

### Machine-local opt-outs

Copy `.jdotignore.example` to the gitignored `.jdotignore` and list package names to skip:

```text
vscode
zed
```

The current `stow` command applies package-name exclusions only. Although the example file describes globs, `jdot` does not pass those globs to Stow. Use Stow's package-local ignore files for file exclusions.

## Pi and skills

Pi discovers both `~/.agents/skills/` and `~/.pi/agent/skills/`. Shared skills have one canonical copy under `home/agents/.agents/skills/`; compatibility symlinks point to it. Pi deduplicates paths to the same file but warns when different files declare the same skill name.

Emil skills stay unchanged in their local installation. Agent instructions prefer the matching Emil skill. `interface-craft` covers DialKit and storyboard tooling; `pi-skills` covers Pi packaging and discovery. The separate `writing-skills` testing workflow is explicit-only.

`preparing-pull-requests` coordinates PR descriptions, screenshot evidence, and Show Me's diff explanations. It loads `write-like-justin`, which requires both `plain-writing` and `emil-unslop-writing`. Capture existing UI before implementation when a PR is intended.

After installing or updating skills:

```bash
./jdot skills-check
./jdot pi-digest
```

Keep shared installs in one root so updates do not recreate divergent copies. Retired skills and superseded copies remain locally in the gitignored `home/pi/.pi/agent/skills-disabled/`, outside discovery. Its `cleanup-manifest.json` records original paths. Shieldcn and Remotion skills are removed from the active catalog.

### Local-only content

A fresh clone does not contain the complete live environment. Private skills, licensed Emil skills, and Interface Craft require separate local provisioning. Symlinks to absent local-only skills can remain unresolved until those skills are installed. Do not force-add their contents to Git.

Private skills include `write-like-justin`, `job-search`, `real-app`, `plan-to-linear`, and `platform-settings-sections`. Personal design rules also remain local. `home/pi/PI.md` records the generating machine's inventory, including local-only skill names; it is not an installation manifest.

Secrets such as `auth.json` and `home/zsh/.zshrc.local`, sessions, caches, dependency directories, compiled helpers, and retired skills are gitignored. Tmux plugins are also ignored and must be installed through TPM. See [`.gitignore`](.gitignore) for the exact exclusions.

## Acknowledgments

Layout inspired by [dmmulroy/.dotfiles](https://github.com/dmmulroy/.dotfiles). Configuration managed with [GNU Stow](https://www.gnu.org/software/stow/) and [Pi](https://github.com/badlogic/pi-mono).
