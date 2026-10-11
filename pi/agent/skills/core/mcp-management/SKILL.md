---
name: mcp-management
description: Add, update, and debug MCP servers with Pi's built-in MCP support. Use when adding an MCP server, editing ~/.pi/agent/mcp.json or a project .pi/mcp.json, signing in to an OAuth server, changing tool exposure, or documenting MCP setup.
---

# MCP Management

Pi has built-in MCP support. Read the full reference before changing config:
`<pi install>/docs/mcp.md` (resolve `<pi install>` from the Pi docs path in the system prompt).

## Where things live

- Global servers: `~/.pi/agent/mcp.json` (tracked in dotfiles at `pi/agent/mcp.json`)
- Project servers: `.pi/mcp.json`, read only in trusted projects
- OAuth tokens: `~/.pi/agent/mcp-auth.json` (gitignored)
- Secrets: `~/.zshrc.local`, referenced as `${NAME}` in `mcp.json`. MUST NOT put literal tokens in `mcp.json`.

## Add a server

1. `pi mcp add <name> -- <command> <args...>` for stdio, or `pi mcp add <name> --url <url>` for HTTP. Edit `mcp.json` directly for fields the command does not cover.
2. Put auth values in `~/.zshrc.local` (`echo 'export NAME="value"' >> ~/.zshrc.local`, then `source ~/.zshrc.local`) and reference them as `${NAME}`.
3. OAuth servers need no auth fields. Run `pi mcp login <name>` and tell the user to approve in the browser.
4. Run `pi mcp list` to verify. It exits non-zero while anything is wrong and prints stdio stderr.
5. Tell the user to `/reload` so the running session connects.

## Rules that are easy to get wrong

- Server names: letters, digits, `_`, `-`. Tools are named `mcp__<server>__<tool>`.
- `command` is one executable; arguments go in `args`.
- SSE transport is rejected. Try the server's `/mcp` endpoint instead of `/sse`.
- Default exposure is `codemode`: tools are called from `codemode` scripts, not declared directly. Use `"exposure": "direct"` only for a small server used constantly, and `deferred` or `codemode-deferred` for large ones.
- Do not install `pi-mcp-adapter` or another extension that registers `/mcp`. It disables the built-in support.

## Debug

- `pi mcp list` for state, tools, and connection errors.
- `/mcp` in a session to reconnect, sign in or out, disable, or change exposure.
- Server log messages land in `~/.pi/agent/mcp.log`.
