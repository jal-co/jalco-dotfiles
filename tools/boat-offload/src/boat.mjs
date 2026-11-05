export class BoatError extends Error {}

function parseLines(text) {
  return text.split("\n").filter((line) => line.trim().startsWith("{")).map((line) => JSON.parse(line));
}

export function createBoat(run) {
  async function call(args, options) {
    const result = await run("boat", [...args, "--no-update"], options);
    if (result.code !== 0) throw new BoatError(`boat ${args[0]} failed${result.stderr.trim() ? `: ${result.stderr.trim().split("\n").pop()}` : ""}`);
    return result;
  }

  return {
    async create({ name, type, environment, hostPorts, ttlSeconds }) {
      const args = ["new", "--json", "--name", name, "--type", type, "--environment", environment, "--ttl", String(ttlSeconds)];
      for (const port of hostPorts) args.push("--host", String(port));
      const events = parseLines((await call(args, { timeoutMs: 300_000 })).stdout);
      const ready = events.find((event) => event.event === "ready");
      if (!ready) throw new BoatError("The sandbox did not report ready.");
      return { id: ready.id, url: ready.url };
    },
    async info(id) {
      const result = await run("boat", ["info", id, "--json", "--no-update"]);
      if (result.code !== 0) return null;
      return parseLines(result.stdout)[0]?.sandbox ?? null;
    },
    async usage(id) {
      const result = await run("boat", ["usage", id, "--json", "--no-update"]);
      const usage = parseLines(result.stdout)[0];
      if (result.code !== 0 || !usage) return null;
      return { dollars: usage.dollars, seconds: usage.seconds, running: usage.running, perHour: (usage.billingMultiplier * 3600) / usage.secondsPerDollar };
    },
    async extend(id, hours) {
      await call(["extend", id, "--hours", String(hours), "--json"]);
    },
    async list() {
      const result = await call(["list", "--json"]);
      return JSON.parse(result.stdout).sandboxes;
    },
    async resume(id) {
      await call(["resume", id, "--json"], { timeoutMs: 300_000 });
    },
    async stop(id) {
      await call(["stop", id, "--json"], { timeoutMs: 300_000 });
    },
    async remove(id) {
      await call(["delete", id, "--yes", "--json"], { timeoutMs: 300_000 });
    },
    async exec(id, script, { timeoutSeconds = 120 } = {}) {
      const result = await run("boat", ["exec", id, "--timeout", String(timeoutSeconds), "--json", "--no-update", "--", script], { timeoutMs: (timeoutSeconds + 30) * 1000 });
      const frame = parseLines(result.stdout).find((entry) => "exitCode" in entry);
      if (!frame) throw new BoatError(`boat exec returned no result${result.stderr.trim() ? `: ${result.stderr.trim().split("\n").pop()}` : ""}`);
      return { code: frame.exitCode, stdout: frame.stdout ?? "", stderr: frame.stderr ?? "" };
    },
    async copy(id, localPath, remotePath) {
      await call(["scp", localPath, `${id}:${remotePath}`]);
    },
    async copyDirectory(id, localDirectory, remoteDirectory) {
      await call(["push", id, localDirectory, "--to", remoteDirectory, "--json"], { timeoutMs: 300_000 });
    },
    async host(id, port) {
      const result = await call(["host", id, String(port), "--localhost", "--json"]);
      const url = parseLines(result.stdout)[0]?.url;
      if (!url) throw new BoatError("boat host returned no URL.");
      return url;
    },
    async environmentExists(name) {
      const result = await run("boat", ["env", "info", name, "--json", "--no-update"]);
      return result.code === 0;
    },
    async ensureEnvironment(name) {
      if (await this.environmentExists(name)) return false;
      await call(["env", "new", name, "--json"]);
      await call(["env", "set", name, "--github", "true", "--secrets", "false", "--agents-credentials", "false", "--boat-credentials", "false", "--json"]);
      return true;
    },
  };
}
