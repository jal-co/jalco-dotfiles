# boat-offload

Run a Git branch on a [Boat](https://boat.dev) sandbox with Rex, Pi and your Claude subscriptions, from one command.

```sh
cd ~/some-repo            # a branch that is pushed to GitHub
boat-offload up --preview 3000 --dev "pnpm dev"
```

`up` is idempotent. Run it again to reuse or resume the same sandbox.

## What `up` does

1. Checks that the branch is pushed to a GitHub `origin`. The sandbox clones from GitHub; uncommitted work stays on the Mac.
2. Creates (or reuses, or resumes) one sandbox per repository and branch, using a Boat environment named `offload` that injects only GitHub access. Account secrets, agent logins and Boat credentials are not passed.
3. Copies your Pi setup to `~/dotfiles` on the sandbox: the Git-tracked and not-ignored files of `pi`, `agents`, `rex` and `tools/anti-slop`, including uncommitted edits, plus the anti-slop `package.json` and lock file that Git ignores. The same path as on your Mac keeps extensions that load `~/dotfiles/...` working. That carries `AGENTS.md`, settings, skills, prompts, themes, workflows, extensions, local packages, `models.json` and `mcp.json`. Ignored files (`auth.json`, `claude-pool.json`, sessions, private skills, `node_modules`) are not sent. It runs `npm ci` for the pool package and the extensions, links everything into `~/.pi/agent`, merges `mcp.json` with the sandbox's own `computer` server, and runs `pi update --extensions` to install your npm and Git packages. Installs the Rex server and Pi if the image lacks them. Clones the repository.
4. Reads the Claude subscription tokens named in `~/.pi/agent/claude-pool.json` on the Mac (through 1Password) and writes each to the sandbox as a mode 600 file. The sandbox's Pi pool config points at those files. No 1Password credential and no Mac Keychain or Pi login data goes to the sandbox.
5. Starts a Rex server on the sandbox, listening on the sandbox's loopback only. A background `boat forward` carries it to a free local port, and the Rex host `boat-<repo>-<branch>` is registered on the Mac.
6. Starts Pi in a Rex session named after the repository. With `--dev`, opens the dev command in a second block of that session. With `--preview PORT`, prints a private HTTPS URL for that port.

Open the Rex host from the Mac app (Add Remote Host with the printed address) or the CLI (`rex -S boat-<repo>-<branch> ls`).

## Commands

| Command | Purpose |
| --- | --- |
| `up [--type small\|default] [--dev CMD] [--preview PORT] [--plan pro\|max] [--tailscale-key op://...] [--no-tailnet]` | Provision and connect |
| `session [--session PATH]` | Fork a Pi session onto the sandbox and open it in its own Rex session |
| `phone [--wait SECONDS]` | Finish the tailnet sign-in and register the tailnet address |
| `attach` | Reconnect Rex to the branch's sandbox after a reboot, sleep or stop |
| `preview PORT` | Print a private HTTPS URL for a sandbox port. Run the dev server first |
| `status` | List offloads on this Mac |
| `down [--delete]` | Stop the sandbox (kept 14 days) and the local forward, or delete it |

Sizes are `small` (2 vCPU, 4 GB, $0.018/h) and `default` (4 vCPU, 8 GB, $0.036/h). The trial account cannot use larger ones.

## Offloading a session

`boat-offload session` copies a Pi session file (by default the newest one for this repository, or `--session PATH`) to the sandbox and starts `pi --fork` on it in a Rex session named `<repo>-fork-<id>`. The original stays on the Mac and keeps running; the fork is a separate session with the same history. Before copying, the file is scanned for credential-shaped text (Anthropic, GitHub, 1Password, Tailscale and AWS keys, JWTs, private keys). A match stops the copy and nothing is sent. The scan is a safety net, not a guarantee: session files hold everything shown in the conversation, so treat the sandbox as holding that history.

The first message in a fork rebuilds the whole conversation for Claude Code, so a long session uses a lot of subscription quota on that turn.

## Phone and other devices

The sandbox's Rex server joins your tailnet with Rex's built-in Tailscale, so the Rex app on your phone, or any device on that tailnet, connects straight to it. `up` turns this on and registers the Rex host with two endpoints: the tailnet address first, then the local Boat forward. Hosts live on your Rex home, so devices that follow it see the host.

The first time a sandbox joins, Tailscale needs a sign-in. `up` prints the link. Open it, then run `boat-offload phone` if `up` finished before you did. A new sandbox is a new device, so each new sandbox asks once. To skip the click, store a reusable Tailscale auth key in 1Password and put its reference in `~/.config/boat-offload/config.json`:

```json
{ "tailscaleKeyRef": "op://VAULT_ID/ITEM_ID/credential" }
```

The key is copied to the sandbox, used once, and deleted. That key path is untested. Your tailnet needs MagicDNS and HTTPS certificates. Use `--no-tailnet` to keep a sandbox off the tailnet. `down --delete` signs the node out of Tailscale before deleting the sandbox; check the Tailscale admin page for leftover devices.

## Safety

- Tokens travel through Boat's API and live on the sandbox disk in mode 600 files. Treat the sandbox like a machine holding those subscriptions: do not share it (`boat share`) or snapshot it for others. Rotate a token by running `claude setup-token` again and updating the 1Password item.
- The sandbox's local Rex listener accepts anonymous callers on the sandbox's loopback. Only code running in the sandbox and the authenticated Boat forward from this Mac reach it. The tailnet listener admits only the tailnet user who signed the node in.
- `down` stops by default. `--delete` is explicit.
- Branch names and remotes are validated before being placed in remote shell commands, and every interpolated value is single-quoted.
- `settings.json` on the sandbox is your dotfiles file with the default provider forced to `claude-bridge` and the model list cut to the Claude pool, because the sandbox holds no OpenAI, xAI or DeepSeek login. Log in there with `/login` for those. Anything that needs a login stays unauthenticated: OAuth MCP servers, the DeepSeek-backed auto-permission reviewer, web-search keys.
- macOS-only extensions (`rex-markdown.ts`, `white-logo-header.ts`) are not linked. Other Mac-specific extensions load but may do nothing on Linux.
- Your Pi setup is about 750 MB with dependencies, so the first `up` takes about a minute. Reruns re-copy it.

## State and files

`~/.local/state/boat-offload/state.json` (mode 600) maps `owner/repo#branch` to its sandbox, Rex host, local port and forward process. `forward.log` in the same directory holds the forward's output.

## Tests

```sh
node --test test/*.test.mjs
```

They cover repository and branch validation, shell quoting, script syntax, provisioning order, token cleanup, reuse and resume, and `down`. They use no network. `up`, `attach`, `preview` and `down` were also run end to end against a real `small` sandbox: Rex and Pi started, a pooled Claude request answered on the sandbox, the Rex host registered, `attach` reconnected, a dev-server URL returned 200, and `down --delete` removed the sandbox, forward and host.
