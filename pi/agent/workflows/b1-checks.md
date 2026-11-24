# Verification on b1

<context>
b1 has 16 logical CPUs. Unbounded test workers have saturated it while Justin was answering an agent question. `app-rexchecks.slice` gives verification jobs a shared ceiling of eight CPUs worth of CPU time, with lower scheduling priority. Rex and Pi remain outside that slice.
</context>

<rules>

- On b1, MUST run tests, builds, typechecks, and other CPU-heavy verification through `rex-check COMMAND [ARG...]`. Concurrent wrapped jobs share one budget, not eight CPUs each. Do not wrap the agent itself, Rex, interactive prompts, or long-running development servers.
- For shell pipelines or multiple commands, wrap the whole check: `rex-check sh -c 'command1 && command2'`. The command inherits the current directory, environment, and terminal streams. Its exit status is preserved.
- Vitest runs MUST use `--maxWorkers=2`. Example: `rex-check pnpm exec vitest run path/to/feature.test.ts --maxWorkers=2`. Keep the repository's existing runner, configuration, coverage flags, and required checks. Do not replace a required package or full-suite run with a targeted run. Worker limits change concurrency, not test selection.
- Start with the relevant package and test files for feedback, then run every broader check required by the repository and task. Do not add `--passWithNoTests`, suppress failures, weaken assertions, or skip tests to save resources.
- If `rex-check` refuses to run because its slice is missing or misconfigured, stop and fix the installation. MUST NOT rerun the same job without the wrapper. It does not constrain commands that bypass it or Docker daemon workloads.
- These limits may make checks take longer. A timeout is not a passing result; investigate it without silently lifting the limits.

</rules>

<instructions>

The Linux dotfiles mappings install `~/.local/bin/rex-check` and `~/.config/systemd/user/app-rexchecks.slice`. After those links exist, run `systemctl --user daemon-reload`. Verify `systemctl --user show app-rexchecks.slice -p CPUQuotaPerSecUSec -p CPUQuotaPeriodUSec -p CPUWeight` reports `8s`, `10ms`, and `20`. No Rex restart is needed. Existing unwrapped jobs are not moved or interrupted.

</instructions>
