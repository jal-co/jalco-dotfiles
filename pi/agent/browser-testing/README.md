# Task browser

<instructions>

Run browser commands through `~/.pi/agent/browser-testing/task-browser`, never the raw CLI. The launcher keeps Chromium headless and worktree-scoped. `mise run bootstrap` installs global `agent-browser@0.38.2` under mise's Node. Load its current command guide with `agent-browser skills get core --full`.

</instructions>

## Mastra Platform test login

<workflow>

1. Use a dedicated, email-verified, password-only user in WorkOS **TEST**, with membership in the test organization. Keep its username and password in a 1Password Login item. The local API must use that same WorkOS test environment. Do not use Justin's account, production credentials, or a social-login account.
2. Sign in to `op` locally. Create `~/.config/task-browser/mastra-test.json`, owned by you with mode `0600`. Set `environment` to `TEST`, `itemReference` to the dedicated item's ID, and `loginOrigin` to the exact HTTPS origin of that test environment's hosted AuthKit page. The origin alone does not prove TEST mode. Confirm it against the test environment before configuring it.
3. Start the OAuth flow in the task browser, then submit the hosted login with `auth-test-login`. Keep login and callback in the same session because Platform binds OAuth state to a browser cookie.

The private configuration has this shape. Replace both placeholders, not the TEST declaration.

```json
{"environment":"TEST","itemReference":"dedicated-test-login-item-id","loginOrigin":"https://your-test-environment.authkit.app"}
```

```bash
BROWSER="$HOME/.pi/agent/browser-testing/mastra-browser"
"$BROWSER" start 'http://localhost:3010/v1/auth/login?product=studio&return_url=http%3A%2F%2Flocalhost%3A5173'
HOSTED_URL="$("$BROWSER" get url)"
"$BROWSER" auth-test-login "$HOSTED_URL"
"$BROWSER" wait --url 'http://localhost:5173/**'
"$BROWSER" snapshot -i
"$BROWSER" auth-save
```

The helper reads `op item get` into memory, saves the password through `auth save --password-stdin`, and calls `auth login --no-navigate` without printing credentials. No 1Password credential-provider plugin is installed. Keep plugin launch capabilities disabled rather than bypassing isolation. The temporary vault profile stays encrypted outside Git and is deleted after the submission attempt. The helper advances the hosted email step. On the password screen, the vault's username and password selectors both target the password input. The vault overwrites the temporary username with the password, then the helper submits once with a trusted click. If the page requires SSO, MFA, or an unsupported form, stop and report it. A submission message is not proof of authentication. Assert the protected route and expected test organization before `auth-save`.

`mastra-browser` uses a separate TEST-session prefix and `~/.agent-browser/auth/mastra-platform-test.json`. `createMastraPage` uses that same seed. Reuse valid test state with `auth-load`. Never print, inspect, commit, or attach credentials or state. Keep state files private with mode `0600`. For sites without a test account, `task-browser auth-import-helium <domain...>` remains available and does not attach to Helium. `mastra-browser` rejects that import so it cannot contaminate the TEST seed.

</workflow>

## WorkOS redirect setup

<instructions>

Justin adds these exact URLs once in the WorkOS **test environment**, not production. Reserve API ports 3010 through 3014. Use `WORKOS_REDIRECT_URI` for the active API port and `WORKOS_DISCOVERY_REDIRECT_URI` for its discovery URL. The API does not derive callbacks from its listening port. Its default stays at 3010. Repo-root `.env` overrides shell values unless `ENV_PRESERVE` names them. Frontend ports are return destinations, not these OAuth callbacks.

```text
http://localhost:3010/v1/auth/callback
http://localhost:3010/v1/auth/callback/discovery
http://localhost:3011/v1/auth/callback
http://localhost:3011/v1/auth/callback/discovery
http://localhost:3012/v1/auth/callback
http://localhost:3012/v1/auth/callback/discovery
http://localhost:3013/v1/auth/callback
http://localhost:3013/v1/auth/callback/discovery
http://localhost:3014/v1/auth/callback
http://localhost:3014/v1/auth/callback/discovery
```

</instructions>

## Run checks in one call

<workflow>

Use `batch --bail` with JSON arrays on stdin. Reacquire refs when the page changes. Keep secrets out of batches, arguments, and output.

```bash
BROWSER="$HOME/.pi/agent/browser-testing/task-browser"
printf '%s\n' '[["open","https://example.com"],["snapshot","-i"],["wait","--fn","document.title === \"Example Domain\""]]' | "$BROWSER" batch --bail
"$BROWSER" diff screenshot --baseline /absolute/path/before.png
"$BROWSER" diff url https://existing-base.example http://localhost:5173
"$BROWSER" close
```

Use accessibility snapshots and `eval` assertions for your checks. Capture screenshots for Justin. Capture before evidence before editing and compare it with `diff screenshot --baseline`. `diff url` compares two already-served versions, not a Git revision. Neither creates missing before evidence. If neither baseline exists, report the missing evidence and stop for a review decision. Do not start a second main server. Reuse one dev server per worktree and Vite's hot updates. Use Storybook `play` tests for shared component interactions. Follow `~/.pi/agent/workflows/frontend.md` for coverage and review.

</workflow>
