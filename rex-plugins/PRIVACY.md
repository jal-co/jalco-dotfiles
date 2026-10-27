# Privacy boundary

This code is maintained in the owner's dotfiles. An earlier snapshot was published at `https://github.com/jal-co/rex-plugins`; that repository is no longer the working source. Private runtime data is never included. Further publication, package-registry publication, vendor feedback submissions and telemetry integration remain separate decisions.

Superlogical's documentation MCP may receive generic questions about public Rex APIs. It must not receive private source code, prompts, terminal captures, task names, project names, logs, credentials or internal issue/PR details. Documentation lookup is separate from local terminal control.

The runtime uses the locally installed Rex CLI over a local Unix socket. It sends Rex the executable paths and arguments needed to create local terminals. Those local calls are not requests to the Superlogical documentation MCP. The task runtime rejects non-local server connections in this milestone.

Task requests, process identities, captured output and Pi session files remain under the selected local state directory. They can contain sensitive material. Files are created with private permissions; no log upload, crash-report upload, analytics, automatic Git publication or cloud sync is implemented. Do not put credentials directly in argv or prompts. Use the launched agent's existing credential mechanism.

A launched coding agent still uses its own configured model provider, tools and network access. This package does not make those agents offline or sandbox them. Authorizing an agent launch is separate from authorizing any vendor disclosure.

Tests use synthetic task names, disposable directories and deterministic local Node processes. They do not invoke a model or submit feedback. Session pinning is opt-in and is not activated during testing.
