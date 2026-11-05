---
name: boat-offload
description: Offload the current Git branch to a Boat cloud sandbox running Rex and Pi with the Claude subscription pool, preview its frontend, reconnect, stop or delete it. Use when Justin says offload to boat, run this on a VM, move this to the cloud, preview from the VM, or asks to attach to, stop or delete a Boat sandbox.
---

# Boat offload

Run `boat-offload` inside the repository. The full behavior and limits are in `~/dotfiles/tools/boat-offload/README.md`.

| Request | Command |
| --- | --- |
| Offload this branch | `boat-offload up` |
| Offload and start the dev server with a preview | `boat-offload up --dev "<command>" --preview <port>` |
| Preview another port | `boat-offload preview <port>` |
| Reconnect after sleep or reboot | `boat-offload attach` |
| Finish phone or tailnet sign-in | `boat-offload phone` |
| Fork the current Pi session onto the sandbox | `boat-offload session` |
| Show offloads, costs and stray sandboxes | `boat-offload status` |
| Give the sandbox more time | `boat-offload extend <hours>` |
| Pause | `boat-offload down` |
| Remove the sandbox | `boat-offload down --delete` |

## Rules

- Push the branch to GitHub first. The command refuses an unpushed branch and does not copy local changes.
- Creating a sandbox costs money while it runs ($0.018/hour `small`, $0.036/hour `default`). Use the default `--type small` unless the work needs more, and ask before `default`. Keep `--hours` at the default of 1 unless Justin asks for longer, report the cost line `up` prints, and run `boat-offload status` before finishing to confirm nothing is left running.
- Stop with `down` when the work is finished. Run `down --delete` only when Justin asks to delete.
- Never print, log or paste token values, and never copy Pi `auth.json`, Keychain data or a 1Password service-account token to a sandbox. The command already delivers only the pool's Claude tokens.
- `session` copies conversation history to the sandbox. Run it only when Justin asks, and tell him a long session costs a lot of quota on its first turn there.
- `up` opens Add Remote Host on Justin's phone the first time for each address. Tell him to tap Add; do not repeat it with `phone` unless he asks.
- A new sandbox needs one Tailscale sign-in link opened by Justin. Print the link `up` or `phone` shows and wait for him; never try to sign in for him.
- Report the Rex host label, the sandbox ID and any preview URL it prints. A preview URL contains an access token: show it to Justin only.
