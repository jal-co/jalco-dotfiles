# Rex plugins

A local-first task runtime and optional plugins for Rex, maintained in this dotfiles repository. This is the first working slice of a replacement for a Pi-specific coordinator, not a drop-in replacement yet.

Nothing here installs itself, changes Rex configuration, reloads an existing agent, or adopts an existing session. The current coordinator stays in dotfiles. Development state defaults to `~/.local/state/rex-plugins`, separate from `~/.rex/tasks` and the existing worktree registry.

## What works

- Launch an executable with an argv array in a new background Rex session.
- Use the optional Pi adapter for a one-shot prompt with a retained Pi session and output logs.
- Keep task records independent of the calling coding agent or MCP connection.
- Create a new Git worktree from an explicit branch and committed base.
- Display the agent beside nested read-only status and details panels.
- Report native Rex status with OSC 7501.
- Request a stop through the original runner. Verify process exit separately.
- Retire a missing terminal only when both recorded processes have exited.
- Call the same operations through a CLI, stdio MCP, or an optional Pi extension.

There are no runtime dependencies beyond Node 24.2+, Git for worktrees, and Rex for terminal operations. The task core does not import Pi, Herdr, or a model SDK.

## Install

Requires Node.js 24.2 or newer, Git, and a running local [Rex](https://www.superlogical.com/rex/docs/installation) server on macOS or Linux. Linux has not yet been live-tested. Run these commands in a Rex terminal so `rex` is on your PATH:

```sh
node --version
rex whoami --json
cd ~/dotfiles/rex
npm test
node task-runtime/src/cli.mjs help
node task-runtime/src/cli.mjs adapters
```

There are no npm dependencies to install and no install scripts. This directory does not register tools, start a service, change Rex settings, or replace an existing coordinator. It is part of dotfiles, not a separate repository or published npm package; `package.json` keeps `private: true` to prevent accidental npm publication.

For an MCP-capable coding agent, use the [MCP configuration](#mcp) below. Get the absolute entry path from this directory with:

```sh
printf '%s/src/cli.mjs\n' "$PWD"
```

For Pi, opt in for one new session without changing persistent settings:

```sh
pi --extension "$PWD/adapters/pi-extension.ts"
```

Updates are managed with the rest of dotfiles. After updating, run `npm test` from this directory.

Restart only the client that loaded this plugin after updating. Existing launched tasks remain independent. Do not restart or replace another coordinator to try it.

## Try it separately

Create a JSON launch file outside your repository:

```json
{
  "name": "example-task",
  "adapter": "command",
  "argv": ["node", "-e", "console.log('hello from Rex')"],
  "cwd": "/absolute/path/to/project",
  "panels": true
}
```

Then run:

```sh
node src/cli.mjs launch /absolute/path/to/task.json
node src/cli.mjs list
node src/cli.mjs show RUN_UUID
node src/cli.mjs capture RUN_UUID
node src/cli.mjs stop RUN_UUID
```

Use an absolute executable path if the Rex server's PATH differs from your shell's. The command adapter can launch an interactive coding agent with its terminal attached. Terminal access is not a conversation protocol: the runtime cannot infer a completed turn, send a safe follow-up, or resume an arbitrary agent.

`panels: true` creates a horizontal split with the agent on the left and a vertical status/details split on the right. No client selection or focus command runs. The status pane watches task files; it does not repeatedly scrape the terminal. The details pane shows the launch snapshot. These are ordinary terminal blocks, not a custom Rex GUI block.

Every CLI command accepts `--root /absolute/state/path`. `REX_PLUGINS_STATE` sets the default. `REX_PLUGINS_REX` selects the Rex executable. Standard `REX_SERVER` targeting still applies, but this build refuses non-local connections because the runner and registry need the same filesystem. A recorded server instance mismatch blocks terminal operations.

## Coding-agent adapters

| Adapter | Terminal | Durable output | Task completion | Follow-up / resume |
| --- | --- | --- | --- | --- |
| `command` | Inherited TTY | On-demand bounded Rex capture only | Process exit | Not yet |
| `pi` | Non-interactive | `stdout.log`, `stderr.log`, `pi-session.jsonl` | Process exit, not semantic success | Not yet |

Pi launch example:

```json
{
  "name": "pi-investigation",
  "adapter": "pi",
  "binary": "/absolute/path/to/pi",
  "model": "provider/exact-model-id",
  "prompt": "Inspect the failing test and report the cause. Do not change files.",
  "cwd": "/absolute/path/to/project"
}
```

The Pi adapter disables extension discovery and MCP connections for the child so it cannot accidentally load the existing coordinator host. Built-in Pi tools remain available. It does not override project-trust approval. A prompt saying "do not change files" is an instruction, not an enforced read-only boundary.

Claude Code, Codex, and other CLI agents can be started through `command` using their documented argv. Dedicated protocol adapters for them have not been implemented or verified. "Agent-independent" here means the core and tool transports do not require a particular agent, not that every agent's conversation protocol is already supported.

## MCP

Configure this explicitly in a separate test client. Do not replace the current coordinator's configuration:

```json
{
  "mcpServers": {
    "rex-plugins": {
      "command": "node",
      "args": ["/absolute/path/to/dotfiles/rex/task-runtime/src/cli.mjs", "mcp"],
      "env": {
        "REX_PLUGINS_STATE": "/absolute/path/to/isolated-state"
      }
    }
  }
}
```

Tools are `rex_agent_launch`, `rex_agent_status`, `rex_agent_list`, `rex_agent_stop`, `rex_agent_capture`, and `rex_agent_adapters`. This server implements stdio initialization, ping, and tools. It advertises no resources, prompts, subscriptions, or task-result notifications. An MCP client disconnect does not terminate the launched agent.

For Pi only, load `adapters/pi-extension.ts` explicitly in a disposable session. It exposes the same tools without MCP. No package setting loads it automatically.

## Worktrees

Replace `cwd` with:

```json
{
  "worktree": {
    "repo": "/absolute/path/to/repository",
    "branch": "feat/task-name",
    "base": "origin/main"
  }
}
```

The runtime resolves the base to a commit before creating the checkout. It does not fetch, copy uncommitted parent edits, commit, push, or remove worktrees. A branch already in use fails instead of being adopted. Checkouts live under the isolated state root. Reuse and cleanup are not implemented yet. Do not delete retained checkout paths to bypass an uncertain run.

## Ownership and stop behavior

The caller writes an immutable launch request and records the returned Rex IDs. A separate runner claims the run once, records its own and its child's process identities, and writes the outcome. Stop requests are files the runner watches; a coordinator never signals a guessed PID or sends raw terminal input.

`stopping` means a request was sent. It does not mean exit was confirmed. `completed`, `failed`, and `stopped` require recorded process-exit evidence. OSC `done` only communicates an outcome to the terminal. Process identity checks decide whether a new run can reuse the name or directory.

An uncertain launch retains its record and blocks reuse. An unreachable server is not a missing terminal. A missing terminal is not a dead process. Missing identity evidence blocks retirement. No elapsed-time threshold frees ownership.

Stops send SIGTERM to the direct child only. They do not escalate to SIGKILL, stop arbitrary descendants, or guarantee cleanup of servers an agent started. Agents have the invoking user's filesystem, network and credential access. This is not a sandbox. MCP clients must obtain authorization before launches and stops. Keep the state directory private; it contains prompts, commands and output.

## Verification

```sh
cd ~/dotfiles/rex
npm test
npm run test:live
```

The normal suite exercises process-backed runners, stop verification, stale retirement, unsafe inputs, duplicate launch protection, worktree isolation, MCP over stdio and status encoding. It makes no model calls.

The live test creates two disposable Rex sessions, checks nested panes, terminal output, native status and stop/reconnect behavior, then closes those sessions. It retains evidence in a temporary directory and verifies that unrelated session IDs remain. It does not activate pinning or change the current coordinator.

## Next stages

1. Persistent task/conversation protocol, result acknowledgement and restart recovery. Separate logical agents from process generations.
2. Pi RPC and additional agent adapters, with explicit capabilities and adapter conformance tests.
3. Event-driven result delivery appropriate to each coordinator. Do not promise automatic model wakeups through generic MCP.
4. Verified checkout reuse, archive-before-cleanup, and descendant-process ownership.
5. Extract PR tracking and the cross-task overview without personal paths or Pi transcript assumptions.
6. Opt-in migration and comparison against the current coordinator. Only replace it after approval.

See [architecture](docs/architecture.md), [Rex evidence](docs/rex-evidence.md), [privacy](PRIVACY.md), and [provenance](PROVENANCE.md).
