# Rex API evidence

Inspected through Superlogical's read-only MCP and the installed Rex CLI on 2026-10-27. The local server reported API revision 7. The implementation uses the installed API's argument and result schemas rather than assuming the newest website feature is installed.

## Sources used

- [CLI](https://www.superlogical.com/rex/docs/automate/cli): session/window/block terminology, immutable IDs, JSON output, target flags, `REX_SERVER`, and CLI exit statuses. Supplied by Justin.
- [Program status](https://www.superlogical.com/rex/docs/build/program-status): OSC 7501, states, nested record IDs, byte limits, base64 strings, blocked kinds and status lifetimes. Supplied by Justin.
- [Lua scripts](https://www.superlogical.com/rex/docs/automate/lua-scripts): nested horizontal/vertical layouts, argv-based execution and event-driven scripts.
- [Lua API](https://www.superlogical.com/rex/docs/reference/lua): configuration actions, terminal methods, timers and process lifetimes.
- [Mac preview.21 release](https://discord.com/channels/1546797889009881158/1547349572299395172/1564391371924705404): pane animations, Activity reporting and process-exit presentation. These are native Rex features, not recreated by this package.
- [CLI 2db8821 release](https://discord.com/channels/1546797889009881158/1547349572299395172/1564391018395205723): CLI changes reviewed for compatibility. No unsupported API inferred from the release title.

## Installed API checks

Used `rex api describe` for `session.create`, `session.list_blocks`, `session.new_layer`, `session.new_window`, `session.destroy`, and `block.close`. Used `rex block types --json` for terminal options and `rex wait --help` for process-exit waiting.

- `session.create` accepts an initial nested layout and returns block IDs in layout order. It does not ask a GUI client to select the session.
- `shell: "none"` starts an argv command directly. `exit.on_completion: false` retains the terminal after exit.
- `session.list_blocks` includes detached blocks. Do not infer absence by scanning only visible windows.
- `session.new_layer` supports floating terminal layouts with explicit bounds and `focus: false`. Not used in the first milestone.
- `terminal.program_status` exposes the records reported through OSC 7501.
- `rex wait` waits for a terminal's child exit even when the terminal is retained.

The available block creators were terminal and onboarding. No general custom GUI/TUI widget extension API was verified. The task panels therefore use regular terminal blocks. A richer visual extension should be based on a documented creator or client API, not guessed hooks.
