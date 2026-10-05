# Pi

Personal [Pi](https://pi.dev) configuration: settings, extensions, skills, MCP servers, prompt templates, and themes. Stowed into `~` by `./jdot stow` from the repository root.

[`PI.md`](PI.md) is the generated inventory of every skill, extension, and package. Regenerate it with `./jdot pi-digest` after adding or removing any of them.

## Setup

```bash
cd ~/dotfiles && ./jdot stow
cd ~/.pi/agent/extensions && npm install
```

Pi installs the packages listed in `settings.json` on first start.

## Structure

```text
.pi/agent/
├── AGENTS.md          # Global agent rules
├── settings.json      # Model, packages, Pi settings
├── models.json        # Custom model definitions
├── mcp.json           # MCP servers (Pi's built-in MCP support)
├── keybindings.json
├── extensions/        # Local extensions
├── packages/          # Local package forks (rpiv-ask-user-question, rpiv-todo)
├── skills/            # Agent skills
├── skills-disabled/   # Archived skills, untracked (see cleanup-manifest.json)
├── prompts/           # Prompt templates
├── workflows/         # Task workflows referenced by AGENTS.md
└── themes/            # verminal, geist-dark
```

Pi also loads shared skills from `~/.agents/skills` (`home/agents` in this repository).

## Settings

| Key | Value |
|-----|-------|
| Provider | `chatgpt` |
| Model | `gpt-5.6-sol` |
| Thinking | `medium` |
| Theme | `verminal` |

## Extensions

### Single-file

| Extension | Description |
|-----------|-------------|
| `confirm-destructive` | Confirms before session switches and forks that discard work |
| `continue-after-compaction` | Resumes the current task after compaction |
| `footer-cleanup` | Footer busy indicator (`/footer-indicator`) |
| `git-interceptor` | Blocks `--no-verify` and makes agent git commands non-interactive |
| `herdr-agent-state` | Reports agent state to Herdr |
| `herdr-main-name` | Names the Herdr pane `main` when Pi starts in `$HOME` |
| `time-tracker` | Tracks active agent time per project for billing |
| `titlebar-spinner` | Braille spinner in the terminal title |
| `tool-reference-alias-fix` | Rewrites aliased tool names in tool-reference blocks |
| `white-logo-header` | Patches Pi's header logo to white |

### Multi-file

| Extension | Description |
|-----------|-------------|
| `anti-slop-gate` | Anti-slop advisory on changed JavaScript and TypeScript |
| `pi-cloak` | Redacts configured patterns (`/cloak-status`) |
| `pi-rfc-keywords` | Uppercases RFC 2119 keywords in prompts |
| `pi-tool-display` | Config for the `pi-tool-display` package's tool overrides |
| `shadcn-lint-gate` | shadcn lint advisory on UI changes |

## Prompt Templates

| Template | Usage |
|----------|-------|
| `/audit-ui` | Audit Mastra UI code against the UI contract and copy rules |
| `/break-it` | Try to break a feature with worst-case data |
| `/dispatch-setup` | Turn a T3 thread into the pinned dispatch thread |
| `/install-mcp` | Install and configure an MCP server |
| `/mastra-better` | Judge whether a change makes Mastra better |
| `/mastra-linear` | Draft a Mastra Linear ticket from a rough note |
| `/mdx-diagram` | Create an ASCII-frame MDX diagram |
| `/migrate-control` | Change a playground-ui control and check for drift |
| `/paper-variants` | Generate a grid of Mastra UI variants in Paper |
| `/refactor-rfc-xml` | Refactor markdown into RFC 2119 + XML style |
| `/review-ui` | Line-by-line UI review |

## MCP

Servers live in `mcp.json`. Manage them with `pi mcp list`, `pi mcp login <server>`, and `/mcp`. Keys go in `~/.zshrc.local`, for example `EXA_API_KEY`.

## Ignored

Runtime state (`auth.json`, `mcp-cache.json`, `sessions/`), `node_modules/`, `skills-disabled/`, and personal skills such as `write-like-justin` and `job-search`. See the repository [`.gitignore`](../../.gitignore).

## Acknowledgments

- [Pi](https://github.com/earendil-works/pi) by Earendil
- [pi-annotate](https://github.com/nicobailon/pi-annotate) by [nicobailon](https://github.com/nicobailon)
- [IgorWarzocha](https://github.com/IgorWarzocha): pi-rfc-keywords, security skills
