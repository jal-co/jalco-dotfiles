# jalco-pi-mono

Personal [pi](https://github.com/badlogic/pi-mono) configuration — extensions, skills, MCP servers, prompt templates, and settings. Managed with [GNU Stow](https://www.gnu.org/software/stow/) for symlink-based deployment.

## Quick Start

```bash
git clone --recurse-submodules https://github.com/justinlevinedotme/jalco-pi-mono.git ~/jalco-pi-mono
cd ~/jalco-pi-mono
stow -t ~ pi

# Install extension dependencies
cd ~/.pi/agent/extensions && npm install
cd ~/.pi/agent/extensions/pi-rfc-keywords && npm install

# Packages in settings.json are auto-installed by pi on first startup
```

Re-stow after changes:

```bash
cd ~/jalco-pi-mono && stow -R -t ~ pi
```

## Structure

```
pi/.pi/agent/
├── AGENTS.md              # Global agent rules
├── settings.json          # Provider, model, packages
├── models.json            # Custom model definitions
├── mcp.json               # MCP server config
├── keybindings.json       # Keybindings
├── extensions/            # Extensions (.ts + multi-file)
├── skills/                # Agent skills
├── prompts/               # Prompt templates
├── themes/                # Custom themes (geist-dark)
└── scripts/               # Helper scripts (discord-mcp.sh)
```

## Settings

| Key | Value |
|-----|-------|
| Provider | Anthropic |
| Model | `claude-opus-4-8` |
| Theme | `geist-dark` |

### Packages

- `pi-mcp-adapter` — MCP adapter/proxy for connecting MCP servers to pi
- `pi-subagents` — subagent orchestration
- `pi-goal-x` — goal mode: persistent objectives, `/goal-set`, Sisyphus style, status overlay
- `context-mode` — context management
- `pi-annotate` — visual browser-to-AI annotation
- `pi-markdown-preview` — markdown preview
- `pi-notify` — desktop notifications
- `pi-updater` — auto-update
- `pi-copy-output` — copy last output
- `pi-skills-sh` — skills.sh ecosystem
- `@juanibiapina/pi-extension-settings` — extension settings UI
- `@howaboua/pi-codex-conversion` — Codex-oriented tool and prompt adapter
- `@howaboua/pi-markdown-workflows` — markdown workflows
- `@howaboua/pi-howaboua-extensions-primitives-sdk` — extension primitives SDK
- `@benvargas/pi-claude-code-use` — Claude Code integration
- `@juicesharp/rpiv-ask-user-question` — structured questionnaire with typed options
- `@juicesharp/rpiv-todo` — todo list overlay that survives reloads and compaction
- `@juicesharp/rpiv-args` — shell-style `$1`/`$ARGUMENTS` and `` !`cmd` `` substitution in skills
- `@neilurk12/pi-clean-footer` — clean footer UI

## MCP

[Exa](https://exa.ai) for web search and research, managed with `pi-mcp-adapter`. Servers from Claude Code are also imported via `imports: ["claude-code"]` in `mcp.json`.

```bash
# Auth
echo 'export EXA_API_KEY="your-key"' >> ~/.zshrc.local
source ~/.zshrc.local
```

## Extensions

### Single-file

| Extension | Description |
|-----------|-------------|
| `confirm-destructive` | Confirm before destructive session actions |
| `custom-header` | Minimal Vercel-themed header |
| `git-push-gate` | Confirm before git push |
| `handoff` | Transfer context to a new focused session |
| `impeccable-commands` | Slash commands for the impeccable skill |
| `nvidia-nim-clean` | NVIDIA NIM API provider with clean streaming |
| `permission-gate` | Confirm before dangerous bash commands |
| `question` | Single question with selectable options |
| `questionnaire` | Multi-step tab-based question wizard |
| `titlebar-spinner` | Braille spinner in terminal title |
| `zmux` | Terminal multiplexer spinner integration |

### Multi-file

| Extension | Description |
|-----------|-------------|
| `pi-agent-manager` | Subagent and skill permission manager |
| `pi-rfc-keywords` | Auto-uppercase RFC 2119 keywords in prompts |
| `pi-skills-sh` | skills.sh ecosystem integration |
| `pi-webfetch` | Enhanced web fetching |

## Skills

| Skill | Description |
|-------|-------------|
| `agent-browser` | Agent-driven browser automation |
| `browser-tools` | Browser automation via Chrome DevTools Protocol |
| `color-accessibility` | Accessible color palette design |
| `component-engineering` | React component engineering standard |
| `docs-writer` | Documentation writing for Shieldcn/Fumadocs |
| `exa` | Web search, crawling, and deep research via Exa |
| `find-skills` | Discover and install skills from skills.sh |
| `git` | Git/GitHub CLI workflows and conventions |
| `grep-app` | Search code across GitHub repositories |
| `hermes-agent` | Nous Research Hermes Agent operations |
| `impeccable` | Frontend design audit, critique, and polish |
| `improve` | Read-only codebase audit and improvement plans |
| `mcp-management` | MCP server config and troubleshooting |
| `openclaw-commands` | OpenClaw command utilities |
| `openclaw-skills` | Create skills in the OpenClaw format |
| `pi-skills` | Meta-skill for creating pi skills |
| `repo-ci` | GitHub CI with Husky and conventional commits |
| `rfc-xml-style` | RFC 2119 + XML tag structure guide |
| `security-ai-keys` | Detect leaked AI API keys |
| `security-secrets` | High-signal secret/credential scanning |
| `shadcn-ui` | shadcn/ui component library patterns |
| `ship-or-skip` | Honest critique and vetting of product ideas |
| `stack-up` | Tech-stack selection and architecture advice |
| `thesvg` | Fetch brand SVG logos and cloud icons |

> Skills excluded from version control (PII): `write-like-justin`, `job-search`, `real-app`

## Prompt Templates

| Template | Usage |
|----------|-------|
| `/install-mcp` | Install and configure an MCP server |
| `/refactor-rfc-xml` | Refactor markdown to RFC 2119 + XML style |
| `/setup-ci` | Set up GitHub CI pipeline |

## What's Ignored

Runtime state (`auth.json`, `mcp-cache.json`, `sessions/`), binaries (`bin/`, `jars/`), `node_modules/`, build artifacts, and personal skills containing PII. See [`.gitignore`](.gitignore).

## Acknowledgments

- [pi](https://github.com/badlogic/pi-mono) by [badlogic](https://github.com/badlogic)
- [pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter) by [nicobailon](https://github.com/nicobailon)
- [pi-annotate](https://github.com/nicobailon/pi-annotate) by [nicobailon](https://github.com/nicobailon)
- [IgorWarzocha](https://github.com/IgorWarzocha) — pi-rfc-keywords, pi-agent-manager, component-engineering, security skills
- [impeccable](https://github.com/designcomputer/impeccable) — frontend design skill
