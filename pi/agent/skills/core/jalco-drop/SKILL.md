---
name: jalco-drop
description: Upload a file, folder, or pasted text to Justin's own host at drop.jalco.dev and hand back a share link. Use when Justin asks to upload, share, drop, host, or send a link to a file, log, diff, snippet, skill, screenshot, or folder, or says "jalco-drop", "drop it", "give me a link", or "share this". Also covers listing and deleting drops.
---

# jalco-drop

`jalco-drop` uploads to drop.jalco.dev and prints the link on stdout. Anyone with the link can open the drop, so every upload publishes its contents.

<constraints>

- MUST upload only when Justin asked for a link in this conversation, or approved this specific upload. A link is public to anyone who gets it, and a deleted drop may already be cached or copied.
- MUST read what you are about to upload and refuse to upload secrets: `.env` files, tokens, keys, cookies, credentials, private customer data. Stop and tell Justin what you found instead.
- MUST NOT print, echo, or paste `JALCO_DROP_TOKEN`. It is the admin token, and it also signs Justin's admin session.
- MUST NOT delete a drop unless Justin names it or asks for it. Deleting breaks every link already shared.

</constraints>

## Setup

The CLI lives in the repository at `~/dev/jalco-drop/bin/jalco-drop`. Call that path when `command -v jalco-drop` finds nothing.

The token comes from `JALCO_DROP_TOKEN`, kept in `~/.zshrc.local`. If it is unset, stop and ask Justin to add it. Do not search for it or guess it.

## Upload

<workflow>

1. Decide what to send.
   - One file: pass the path.
   - A folder: pass the directory. The CLI zips it and skips `.git`, `node_modules`, and `.DS_Store`.
   - Generated text, a diff, or command output: pipe it on stdin and set `-n` with a real extension, such as `-n fix.diff` or `-n notes.md`. The extension picks the syntax highlighting, and the default `paste.txt` gets none.
2. Decide who can open it.
   - Private, personal, or work material: add `-p <password>`. Give Justin the password in the same reply, on its own line, so he can pass it on separately.
   - Anything temporary, such as logs, debug output, or review material: add `-e 7d`. Use `-e 1d` for anything sensitive. Durations take `h` or `d`.
   - Leave both off only when Justin says it is fine to be public and permanent.
3. Set `-s <slug>` only when Justin wants a readable link, such as `-s clean-copy`. Random slugs are 10 characters and hard to guess, and a readable slug is easy to guess. The command fails if the slug is taken.
4. Run it, then reply with the printed URL as the first line.

</workflow>

```sh
jalco-drop notes.md
jalco-drop -e 7d -p "$(openssl rand -base64 12)" ~/skills/my-skill
git diff | jalco-drop -n fix.diff -e 7d
jalco-drop -s clean-copy ~/.pi/agent/skills/design/clean-copy/SKILL.md
```

## What the link shows

- Text and code up to 512 KB open in a highlighted viewer with line links. Append `#L12` to point at a line. Larger text gets a download page.
- PNG, JPEG, GIF, WebP, and AVIF images preview in the page.
- Folders and `.zip` files (except Scrawl captures, below) open as a "Justin sent you" page with a file tree in a card, a Download button, and a drawer that previews each file. The gradient on the right is generated from the upload's checksum. Zip64 archives and encrypted entries fall back to download only. Videos inside a zip play in the drawer.
- Everything else gets a download page.
- `<link>/<filename>` serves the raw bytes. Add `?download=1` to force a download.
- Markdown (`.md`, `.markdown`) opens rendered, with highlighted code blocks and frontmatter shown as YAML. Raw HTML inside markdown shows as text.
- HTML (`.html`, `.htm`) opens rendered in a sandboxed frame. Its scripts run, but cannot reach cookies or the rest of drop.jalco.dev. Do not rely on `localStorage`, same-origin requests, or loading other drops from inside it.
- Both have a Source view at `<link>?view=source`.
- On a single file, every action (Copy, Download, Open raw, Source, Copy link) lives in the `...` button in the top-right, and the same actions open as a pie menu on right-click. Size, lines, lock and expiry sit in the bottom-left corner.
- The raw URL always serves text as plain text, so `<link>/<filename>` never runs HTML.

The largest single drop is 100 MB. Split larger material or ask Justin.

## Scrawl captures

Pass the `.scrawl` folder straight to `jalco-drop`. The CLI detects `scrawl.json` and uploads only the video, `frames/`, the contact sheet and a trimmed `scrawl.json`. It merges `audio.wav` into the video with `ffmpeg`, since Scrawl records them separately, and drops `frames-full/`, the cursor track and the list of every window title on Justin's screen. Without `ffmpeg` it warns and uploads a silent video. Do not copy or trim the folder yourself.

A capture expires after 30 days unless `-e` is set. Still watch the video before uploading: it shows whatever was on screen.

The link opens a Scrawl page with the video on the left and a sidebar with the transcript and each marked moment. Clicking a moment jumps the video there.

```sh
jalco-drop ~/Library/Application\ Support/scrawl/captures/scrawl-<id>.scrawl
```

## Manage

```sh
jalco-drop -l
jalco-drop -d <slug>
```

`-l` prints every drop as JSON with its slug, name, size, lock state, and expiry.

## Failures

- `Upload failed (401)`: the token is wrong or unset. Ask Justin. Do not retry with other values.
- `Upload failed (409)`: the slug is taken. `400` means the slug or expiry is malformed. Pick another slug or drop `-s`.
- `Upload failed (429)`: more than 60 requests in a minute. Wait a minute and retry once.
- `Upload failed (503)`: the Worker has no `ADMIN_TOKEN`. Tell Justin it needs `npx wrangler secret put ADMIN_TOKEN`.
- Connection refused or DNS failure: drop.jalco.dev is not deployed yet. Tell Justin and stop.
