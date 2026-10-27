# Runbook

Installed locally at `pi/agent/extensions/runbook`, discovered through the existing `~/.pi/agent/extensions` symlink. The directory and its three upstream helpers under `pi/agent/extensions/shared` are ignored by Git because no applicable distribution license was found. This is a personal installation, not a vendored public copy.

Source: https://github.com/polo871209/dotfiles/tree/3013cb4fa843a629c8cd3ab210a4f113a633589e/.pi/agent/extensions/runbook

The installed files are unchanged from that revision. The required helpers are `shared/exec.ts`, `shared/link.ts` and `shared/message.ts`. Pi supplies its own runtime packages and TypeBox through its extension loader; no npm dependencies were added.

## Use

Start a new Pi session or run `/reload` in an idle session.

- `/run` or `/copy-blocks`: browse shell steps from the last response and run, copy or send them.
- `Ctrl+Alt+C`: open the same browser.
- `show_runbook`: lets the model present command cards for you to execute.
- In Rex, `/send-target` chooses a pane and `Ctrl+Alt+S` sends the next step. Sending stages the command; you press Enter to execute it.
- `/copy-all`: copies the conversation to your clipboard only when invoked.

The command cards provide their own mouse controls. Automatic action links under ordinary Markdown fences depend on the upstream author's separate TUI customization, which was not installed because it also changes the editor, rendering and status indicators.

## Verification

The installed extension loaded through Pi's actual loader without errors and registered its runbook tool and commands. A synthetic command executed through the installed Runbook Pane in a disposable Rex session, returned exit code zero and captured the expected output. The fixture session was closed afterward. No existing coordinator was reloaded or replaced.
