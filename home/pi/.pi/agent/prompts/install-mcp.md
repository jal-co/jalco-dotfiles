---
description: Install and configure an MCP server in Pi using built-in MCP, ~/.pi/agent/mcp.json, and env-based auth in ~/.zshrc.local
argument-hint: <server-name-or-package>
---

# Install MCP Server

Install and configure the MCP server `$1` using the current Pi MCP flow.

Follow this workflow exactly:

1. Determine the correct MCP npm package / command for `$1`.
2. If auth or host configuration is required:
   - identify the required environment variables
   - append them to `~/.zshrc.local` using:
     ```bash
     echo 'export NAME="value"' >> ~/.zshrc.local
     ```
   - tell the user repeated `echo >> ~/.zshrc.local` commands create duplicate lines
   - run:
     ```bash
     source ~/.zshrc.local
     ```
3. Add the server with `pi mcp add`, or edit `~/.pi/agent/mcp.json` directly for fields the command does not cover.
4. Use `${VAR}` interpolation in `mcp.json` for any auth/config values from shell env. For OAuth servers, run `pi mcp login <name>` instead.
5. Keep the default `codemode` exposure; only set `"exposure": "direct"` if there is a clear reason.
6. Run `pi mcp list` and fix any errors it reports.
7. If helpful, create or update a skill documenting:
   - what the MCP server does
   - when to use it
   - required env vars
   - common workflows
   - troubleshooting
8. Tell the user to run `/reload`.
9. Summarize exactly what changed, including file paths.

Constraints:
- Do **not** use MCPorter or install `pi-mcp-adapter`; it disables built-in MCP.
- Do **not** generate standalone CLIs from MCP servers.
- Do **not** put long-lived secrets directly into `mcp.json` when env vars can be used.
- Prefer editing `~/.pi/agent/mcp.json` over ad-hoc local config files.
- If the package or setup is ambiguous, inspect docs before changing config.

Useful target files:
- `~/.pi/agent/mcp.json`
- `~/.zshrc.local`
- `~/.pi/agent/skills/mcp-management/SKILL.md`
- `~/.pi/agent/skills/pi-skills/SKILL.md`

Expected output:
- `pi mcp list` passing for the new server
- updated `~/.pi/agent/mcp.json`
- appended env vars to `~/.zshrc.local` if needed
- clear final summary with exact paths and next steps
