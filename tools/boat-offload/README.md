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
3. Copies `pi/agent/packages/pi-claude-pool` and installs it. Installs the Rex server and Pi if the image lacks them. Clones the repository.
4. Reads the Claude subscription tokens named in `~/.pi/agent/claude-pool.json` on the Mac (through 1Password) and writes each to the sandbox as a mode 600 file. The sandbox's Pi pool config points at those files. No 1Password credential and no Mac Keychain or Pi login data goes to the sandbox.
5. Starts a Rex server on the sandbox, listening on the sandbox's loopback only. A background `boat forward` carries it to a free local port, and the Rex host `boat-<repo>-<branch>` is registered on the Mac.
6. Starts Pi in a Rex session named after the repository. With `--dev`, opens the dev command in a second block of that session. With `--preview PORT`, prints a private HTTPS URL for that port.

Open the Rex host from the Mac app (Add Remote Host with the printed address) or the CLI (`rex -S boat-<repo>-<branch> ls`).

## Commands

| Command | Purpose |
| --- | --- |
| `up [--type small\|default] [--dev CMD] [--preview PORT] [--plan pro\|max] [--tailscale-key op://...]` | Provision and connect |
| `attach` | Reconnect Rex to the branch's sandbox after a reboot, sleep or stop |
| `preview PORT` | Print a private HTTPS URL for a sandbox port. Run the dev server first |
| `status` | List offloads on this Mac |
| `down [--delete]` | Stop the sandbox (kept 14 days) and the local forward, or delete it |

Sizes are `small` (2 vCPU, 4 GB, $0.018/h) and `default` (4 vCPU, 8 GB, $0.036/h). The trial account cannot use larger ones.

## Phone

Rex on iOS needs the sandbox on your tailnet. Pass `--tailscale-key op://VAULT/ITEM/field` with a Tailscale auth key stored in 1Password. The key is copied to the sandbox, used once by `rex server tailscale on`, and deleted. This path is untested. Without it, only this Mac reaches the sandbox, through the Boat forward.

## Safety

- Tokens travel through Boat's API and live on the sandbox disk in mode 600 files. Treat the sandbox like a machine holding those subscriptions: do not share it (`boat share`) or snapshot it for others. Rotate a token by running `claude setup-token` again and updating the 1Password item.
- The sandbox Rex listener accepts anonymous callers on the sandbox's loopback. Only code running in the sandbox, and the authenticated Boat forward from this Mac, can reach it.
- `down` stops by default. `--delete` is explicit.
- Branch names and remotes are validated before being placed in remote shell commands, and every interpolated value is single-quoted.
- Pi on the sandbox starts on the `claude-bridge` models only. Log in to OpenAI there with `/login` if you want those models.

## State and files

`~/.local/state/boat-offload/state.json` (mode 600) maps `owner/repo#branch` to its sandbox, Rex host, local port and forward process. `forward.log` in the same directory holds the forward's output.

## Tests

```sh
node --test test/*.test.mjs
```

They cover repository and branch validation, shell quoting, script syntax, provisioning order, token cleanup, reuse and resume, and `down`. They use no network. `up`, `attach`, `preview` and `down` were also run end to end against a real `small` sandbox: Rex and Pi started, a pooled Claude request answered on the sandbox, the Rex host registered, `attach` reconnected, a dev-server URL returned 200, and `down --delete` removed the sandbox, forward and host.
