# Coding-agent access to 1Password

On this Mac, `~/.local/bin/op` links to `tools/agent-op/op`. Pi child processes set `AI_AGENT=pi` and `PI_CODING_AGENT=true`. The wrapper recognizes either marker, loads a read-only service-account token from macOS Keychain, and runs Homebrew's `op` with it. Commands outside Pi pass through unchanged.

The service account can read only the `Agents` vault in Justin's personal 1Password account. It cannot read `Personal`, change items, share items, or create vaults. These markers select authentication; they are not a security boundary against other programs running as Justin.

The token is stored in the login Keychain under service `1password-coding-agents`, with the current macOS username as its account. `/usr/bin/security` is trusted to retrieve it. A recovery copy is saved as `Coding Agents service account` in the `Personal` vault. No token is stored in dotfiles.

If the Keychain token is missing or invalid, the wrapper stops. It does not fall back to personal-vault authentication. Conflicting account, Connect, and generic session settings are removed from the child environment.

## Available credentials

The `Agents` vault contains copies of these API Credential items:

- `cliproxyapi-local`
- `cliproxyapi-management`
- `cliproxyapi-deepseek`
- `cliproxyapi-openrouter`

The originals remain in `Personal`.

The vault also contains four explicitly approved copies from the Mastra account:

- `Platform test user (WorkOS test)`
- `Frontend Local .env`
- `UI Explorer OpenAI API Key`
- `mastra-cloud Monorepo Local .env`

These copies keep their original item types and have `Work` and `Development` tags. The original Mastra items are unchanged. The `.env` items are whole configuration bundles, not individual API keys.

Copies do not update automatically. When rotating a credential, update its `Agents` copy as well.

Use `op run` to inject a credential into a process without printing it:

```sh
OPENAI_API_KEY=op://Agents/cliproxyapi-local/credential op run -- your-command
```

This example supplies only the API key. Configure the application's CLIProxy endpoint separately.

## Check access

Inside Pi, `op user get --me --format json` should identify a `SERVICE_ACCOUNT` named `Coding Agents`. `op item list --vault Agents` should list eight items. Reading `Personal` should fail without a biometric prompt.

Normal terminal commands retain desktop-app authentication. For an explicitly approved personal-vault operation from Pi, use `/opt/homebrew/bin/op` with the personal account selected. That command still requires the usual personal authorization.

Run the wrapper's offline checks with `python3 tools/agent-op/test.py` from the dotfiles checkout. They check both Pi markers, terminal passthrough, argument handling, conflicting authentication settings, and missing or invalid tokens without accessing real credentials.

## Token expiry

The token was created on October 23, 2026, with an 89-day lifetime. This CLI rejects expiries of 90 days or longer. Renew before January 20, 2027, using 1Password's service-account management page. Keep access restricted to `Agents` with `read_items` only.

Store the replacement token in the same Keychain entry and update its recovery copy in `Personal`. Never put it in shell arguments, shell history, dotfiles, or chat. This setup is local to this Mac; other machines and non-Pi agents are not configured.

[1Password service-account documentation](https://developer.1password.com/docs/service-accounts/get-started/)
