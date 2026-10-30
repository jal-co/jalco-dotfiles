# jalco-dotfiles

Personal macOS setup: shell, Git, terminal, editor, and [Pi](https://pi.dev). [mise](https://mise.jdx.dev) does everything: it installs Homebrew packages, links config files into `~`, and installs runtimes. Everything lives in [`mise.toml`](mise.toml).

## Setup

Install mise first (`curl https://mise.run | sh`), then:

```bash
git clone https://github.com/jal-co/jalco-dotfiles.git ~/dotfiles
cd ~/dotfiles
mise trust
mise bootstrap --dry-run
mise bootstrap
cd ~/.pi/agent/extensions && npm install
```

`mise bootstrap` installs the packages in `[bootstrap.packages]`, links every entry in `[dotfiles]`, installs runtimes from `mise/config.toml`, and installs the global npm packages listed in the `bootstrap` task. Pi installs the packages in `pi/agent/settings.json` on first start.

Tinycast comes from a third-party tap that mise can only read with Ruby 3, so install it with Homebrew: `brew install --cask abue-ammar/tinycast/tinycast`.

## Day to day

| Task | Command |
| --- | --- |
| See what is linked and what drifted | `mise dot status` |
| Preview changes | `mise dot diff` or `mise dot apply -n` |
| Re-link after adding an entry | `mise dot apply` |
| Open the Rex coordinator | `pinned` |
| Add a package | `mise bootstrap packages use brew:<name>` or `brew-cask:<name>` |
| Check packages | `mise bootstrap packages status` |

To manage a new file, move it into a folder here, add a line to `[dotfiles]`, and run `mise dot apply`. Most entries link a whole folder. Pi uses a glob entry that links each top-level item in `pi/agent/` individually, so their sessions, logs, sockets, and auth stay in `~` and out of this repository. A new file added there is linked on the next `mise dot apply`.

## Rex

`pinned` opens the default coordinator in Rex. Tasks use separate Rex sessions and managed worktrees, with automatic results and persistent follow-up. See [`rex/README.md`](rex/README.md) for ownership, cleanup, appearance backup and recovery limits.

## Private files

Private skills and Zed prompts live in the private repo `jal-co/dotfiles-private`. Clone it to `~/dotfiles-private` and run its `link.sh`. Credentials live in Proton Pass, not in either repo.

## Layout

| Folder | Linked to |
| --- | --- |
| `zsh/` | `~/.zshrc` |
| `git/` | `~/.config/git` |
| `ghostty/`, `eza/`, `zed/`, `ponytail/`, `mise/` | `~/.config/<name>` |
| `starship/` | `~/.config/starship.toml` |
| `agents/` | `~/.agents` (shared skills) |
| `rex/` | Rex agent host, task runtime, session pins, launcher, `~/rex-coord` rules and settings, appearance backup |
| `pi/` | config entries in `~/.pi` and `~/.pi/agent` |
| `tools/anti-slop/` | not linked; run through the `anti-slop` alias |

Machine-specific shell settings and secrets go in `~/.zshrc.local`, which is not in this repository.

## Pi

| Path in `pi/agent/` | Purpose |
| --- | --- |
| `AGENTS.md` | Global agent rules |
| `settings.json` | Model, packages, Pi settings |
| `models.json`, `mcp.json`, `keybindings.json` | Models, MCP servers, keys |
| `extensions/` | Local extensions |
| `packages/` | Local forks of `rpiv-ask-user-question` and `rpiv-todo` |
| `skills/` | Pi-only skills |
| `prompts/` | Prompt templates |
| `workflows/` | Task workflows referenced by `AGENTS.md` |
| `themes/` | `pierre-dark`, `verminal`, `geist-dark` |
| `browser-testing/` | Headless browser wrapper used by `AGENTS.md` |

Pi also loads shared skills from `~/.agents/skills`. Keep each skill in one of the two roots, not both.

In `pi/agent/skills`, `core/` holds the everyday skills, `work/` the Mastra skills and the ones `mastra-work` routes to, and `design/` the licensed Emil skills. Pi finds skills in subfolders. A skill with `disable-model-invocation: true` is hidden from automatic selection and read by path. Skills installed with `npx skills` stay flat in `agents/skills`, because `skills update` writes them there.

MCP servers live in `mcp.json`. Manage them with `pi mcp list`, `pi mcp login <server>`, and `/mcp`. API keys go in `~/.zshrc.local`.

### Local-only content

A fresh clone does not include everything. These are gitignored and installed separately:

- Licensed skills: the `emil-*` skills and `interface-craft`.
- Private skills: `write-like-justin`, `job-search`, `real-app`, `plan-to-linear`, `platform-local-dev`.
- Mastra skills and prompts that link to `~/dev/agent-contracts-justin`.

Sessions, auth, caches, and retired skills stay in `~/.pi/agent`, outside this repository.

## Acknowledgments

Layout inspired by [dmmulroy/.dotfiles](https://github.com/dmmulroy/.dotfiles). `tools/anti-slop` is vendored from dmmulroy's anti-slop oxlint plugin. [pi-rfc-keywords](https://github.com/IgorWarzocha) and the security skills come from IgorWarzocha.
