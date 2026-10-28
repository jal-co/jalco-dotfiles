# Markdown links from Pi to Rex

Click a local Markdown link in Pi to open a styled preview in terminal-browser beside that Pi pane. Pi keeps focus. Use `Ctrl+Q` in the preview pane to close it. Web links in Pi keep their normal behavior.

The Pi extension transforms display text, not stored messages or model context. macOS hands `rex-md:` links to a small background app, which invokes Rex directly. Rex creates the split; terminal-browser runs inside it and uses its built-in Markdown renderer. The bridge selects its Kitty animation presenter so scrolling updates the existing image instead of replacing the entire frame. Automatic selection does not recognize Rex and uses whole-frame replacement. The installer caps this dedicated viewer at 30 frames per second: the default display-rate setting can overwhelm Rex with roughly 100 updates per second during scrolling. There is no external browser window, HTTP server, or always-running bridge.

## Install

Requires macOS, local Rex with Kitty graphics support, Pi with `registerMarkdownTransformer`, Node, Xcode command-line tools, and terminal-browser.

```sh
HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 brew install --cask terminal-browser
node ~/dotfiles/tools/rex-markdown/install.mjs
```

The extension lives at `~/dotfiles/pi/agent/extensions/rex-markdown.ts`, loaded through the existing `~/.pi/agent/extensions` symlink. Run `/reload` in each existing Pi session after the initial installation. Reload rebuilds the display links with fresh tickets. Switching from the Glow dispatcher does not require reloading Pi: existing tickets use the updated dispatcher.

The installer creates `~/Applications/Rex Markdown.app` and registers only the `rex-md:` URL scheme. It records the current Node, Rex, and terminal-browser executable paths. Rerun it if those paths change. It does not change the default application for `.md` files or alter Rex configuration. Glow is no longer used by the bridge; an existing Glow installation is left alone.

## Paths and safety

- Existing `.md` and `.markdown` files support project-relative paths, absolute paths, `~/`, and local `file:` URLs. The bridge currently ignores fragments.
- A root-prefixed path such as `/.mastracode/report.md` is resolved under Pi's working directory only when the absolute file does not exist and that project file does.
- Code examples, images, missing files, remote `file:` URLs, and web links are not rewritten.
- Links contain random 256-bit tickets, not executable commands or filesystem paths. Private ticket files hold the destination. Unknown tickets and non-local Rex destinations are rejected.
- Arguments go directly to Rex and terminal-browser without a shell. Filenames are encoded using terminal-browser’s `terminal-browser-file:` preview scheme, which invokes its Markdown renderer rather than downloading the file. The originating Pi session and pane must still exist.
- Markdown previews have an isolated home directory plus a separate browser profile, configuration, cache, history, and daemon under `~/.local/state/rex-markdown-browser`. They never attach to personal browser profiles or merge into another terminal-browser instance. Upstream first-run agent/editor setup stays inside the isolated home directory.
- `TERMINAL_BROWSER_NO_TELEMETRY=1` disables terminal-browser usage telemetry and crash reporting for these previews. Its Chromium engine still runs while a preview is open; the dedicated daemon exits after its final preview closes.
- Pi removes its tickets on shutdown or reload. Old terminal scrollback links expire; freshly rendered links work. A crash can leave unusable ticket files behind.

Handler output and errors are in `~/Library/Application Support/Rex Markdown/handler.log`. If a preview exits immediately, inspect that log and the pane's startup error. Browser logs are under `~/.local/state/rex-markdown-browser/state`. This bridge is local-only; it does not support remote Rex servers.

## Checks

```sh
node --test ~/dotfiles/tools/rex-markdown/bridge.test.mjs
```

The extension lifecycle test requires the installed handler. Native URL dispatch and terminal-browser rendering also need a live Rex terminal and are verified separately.
