# Claude subscription pool for Pi

One `claude-bridge` provider uses several Claude subscription tokens through the Claude Agent SDK. Select an Opus or Sonnet model once. The extension assigns accounts and handles eligible failures without changing the selected model.

It composes `pi-claude-bridge@0.10.0`; it does not patch that package, impersonate the direct Anthropic API, or run a proxy server. Provider permission and subscription terms still apply. This is not a guarantee against account restrictions.

## Routing

- New sessions rotate across available accounts. A session stays on its assigned account to preserve caching.
- A confirmed quota rejection or invalid authentication can retry on another account, once per account per request. Other failures do not trigger account switching.
- After any text, thinking or tool event has streamed, failure stops the request instead of replaying it. Claude Code's synthetic error notices are not model output and can still fail over.
- A tool-result continuation stays on the account owning its parked SDK process. If that process reports a limit before producing new output, the next account receives the conversation including completed tool results.
- Quota cooldowns use provider reset times. Without a usable reset, the account becomes eligible for another attempt after 60 seconds. An invalid token stays blocked until its value changes.
- Exhausting the pool reports account names and cooldowns. It does not wait indefinitely or enable paid API usage. If Extra Usage is enabled on the Claude account itself, Claude Code may bill it before rejecting a request; disable that in Claude if unwanted.

State lives in `<agent-dir>/state/claude-pool.sqlite`. Transactions coordinate Pi processes on the same machine. Only account IDs, token fingerprints, cooldowns and session assignments are stored. Assignments unused for 30 days are discarded.

Each machine has its own state. A Mac and Boat VM can use the same references, but they do not share live cooldowns or a global quota counter. Provider limits remain account-wide. Do not place the SQLite file on a shared network filesystem.

## Install

Requires Node 24.19+ and Pi 1.4+. From this package directory:

```sh
npm ci --ignore-scripts --legacy-peer-deps
pi install .
```

Pi supplies the peer dependencies. The SDK dependency supplies the platform-specific Claude Code binary. Do not load standalone `pi-claude-bridge` or another fork alongside this wrapper. Leave the bridge's legacy `askClaude.enabled` off; that tool does not use this pool.

Run `/reload`, then select `claude-bridge/claude-sonnet-5-5` or `claude-bridge/claude-opus-5-5` with `/model`. This does not change Codex or remove existing proxy credentials.

## 1Password tokens

Create `<agent-dir>/claude-pool.json`, normally `~/.pi/agent/claude-pool.json`:

```json
{
  "accounts": [
    { "id": "claude-sub-1", "tokenRef": "op://VAULT_ID/FIRST_ITEM_ID/credential" },
    { "id": "claude-sub-2", "tokenRef": "op://VAULT_ID/SECOND_ITEM_ID/credential" }
  ]
}
```

Use the existing `claude setup-token` values stored in those fields. The file contains references, not tokens. Vault and item IDs avoid ambiguity when names change.

The extension calls `op read` without a shell, captures stdout in memory, and never forwards its raw error output. Reads time out after ten seconds. Successful reads are cached for the extension's lifetime so tool turns do not repeatedly contact 1Password. Run `/reload` after rotating an item. Reads do not create or modify vault items.

`op` must be on PATH with noninteractive access to the referenced vault. On Justin's Mac the existing `tools/agent-op` wrapper uses the read-only service account from Keychain. On Linux, use the native 1Password CLI with a separately provisioned, narrowly scoped `OP_SERVICE_ACCOUNT_TOKEN`. The Mac wrapper is not portable to Linux. The extension disables biometric unlocking; it does not start a browser login.

Each account must have exactly one secret source. Alternatives are:

```json
{
  "accounts": [
    { "id": "one", "tokenEnv": "CLAUDE_POOL_ONE" },
    { "id": "two", "tokenFile": "/home/user/.config/claude-pool/two.token" }
  ]
}
```

Environment references must start with `CLAUDE_POOL_`. Token files must be absolute paths, owned by the current user and inaccessible to group/other users, for example mode `600`. File tokens are reread per request. Never paste token values into chat, command arguments, dotfiles or VM images.

The SDK child receives the selected token as `CLAUDE_CODE_OAUTH_TOKEN`. Pool token environment variables, 1Password service/Connect tokens, and conflicting Anthropic auth and provider selectors are removed from that child's environment. Pi's own environment is not changed. Pi tools and other trusted extensions still have the user's process permissions; this is credential routing, not a sandbox.

Keep Claude Code's user settings free of conflicting auth helpers or provider overrides. `CLAUDE_BRIDGE_TRACE_PROXY` is rejected for pooled requests.

## Boat

Use an existing private sandbox with Node 24.19+, Pi 1.4+ and Linux `op`. No Rex changes or connection to the home proxy are needed for Claude.

From the Mac, copy this package's source, excluding ignored dependencies:

```sh
boat push "$SANDBOX_ID" "$HOME/dotfiles/pi/agent/packages/pi-claude-pool" --to /home/user/pi-claude-pool
boat exec "$SANDBOX_ID" --cwd /home/user/pi-claude-pool -- npm ci --ignore-scripts --legacy-peer-deps
boat exec "$SANDBOX_ID" -- pi install /home/user/pi-claude-pool
```

Create the reference-only `~/.pi/agent/claude-pool.json` for the Linux user running Pi. Provision the 1Password service-account credential through the VM's approved secret-injection mechanism, not a literal `boat exec` command. Boat retains command history. Do not copy Mac Keychain data, Pi auth files or login sessions to the VM, and do not share or snapshot a sandbox containing personal credentials.

Then start Pi normally from Rex or SSH and choose a `claude-bridge` model. Closing the phone connection does not itself manage VM lifetime: keeping Boat and Rex running is a separate orchestration concern.

No Boat sandbox was created or modified by this change.

## Verification

```sh
npm test
```

The tests cover account affinity, eight concurrent Pi processes, cooldowns, token rotation, secret references and redaction, aborted and partial streams, tool-result continuations, and bounded failover. The bridge smoke test runs the real Pi loader and bridge with a simulated SDK, including Claude Code's synthetic quota notice. It makes no model request and has an isolated home directory.

Verified on macOS and a Linux Node 24 container. Two separate, tool-free live Sonnet probes also returned the expected response using the two 1Password-backed accounts locally. Live quota exhaustion and a real Boat deployment have not been exercised.

Config and routing-state boundaries are validated with TypeBox schemas. No type assertions or lint-suppression comments are used.
