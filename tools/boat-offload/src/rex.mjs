export const endpoint = (port) => `http://127.0.0.1:${port}`;

export function createRex(run) {
  const call = (port, args, options) => run("rex", ["-S", endpoint(port), ...args], options);

  return {
    async reachable(port) {
      return (await call(port, ["whoami"], { timeoutMs: 15_000 })).code === 0;
    },
    async waitReachable(port, attempts = 20, delayMs = 1000) {
      for (let attempt = 0; attempt < attempts; attempt++) {
        if (await this.reachable(port)) return true;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      return false;
    },
    async registerHost(label, port) {
      const listed = await run("rex", ["hosts", "list", "--json"]);
      let known = false;
      try {
        known = JSON.parse(listed.stdout).hosts.some((entry) => entry.host?.label?.toLowerCase() === label.toLowerCase());
      } catch {
        throw new Error("rex hosts list returned output boat-offload could not read.");
      }
      const result = known
        ? await run("rex", ["hosts", "edit", label, "--endpoint", endpoint(port)])
        : await run("rex", ["hosts", "add", label, endpoint(port)]);
      if (result.code !== 0) throw new Error(`rex hosts failed: ${result.stderr.trim().split("\n").pop()}`);
    },
    async removeHost(label) {
      await run("rex", ["hosts", "remove", label]);
    },
    async hasSession(port, label) {
      const result = await call(port, ["ls", "--json"]);
      if (result.code !== 0) return false;
      try {
        return JSON.parse(result.stdout).some((session) => session.label === label);
      } catch {
        return result.stdout.split("\n").some((line) => line.split(/\s+/)[0] === label);
      }
    },
    async ensureSession(port, label, cwd, command) {
      if (await this.hasSession(port, label)) return false;
      const result = await call(port, ["new", label, "-c", cwd, "--", ...command]);
      if (result.code !== 0) throw new Error(`rex new failed: ${result.stderr.trim().split("\n").pop()}`);
      return true;
    },
    async runBlock(port, session, command) {
      const result = await call(port, ["run", "-s", session, "--", "bash", "-lc", command]);
      if (result.code !== 0) throw new Error(`rex run failed: ${result.stderr.trim().split("\n").pop()}`);
    },
  };
}
