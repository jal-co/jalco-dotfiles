export const endpoint = (port) => `http://127.0.0.1:${port}`;

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

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
    async registerHost(label, port, extraEndpoints = []) {
      const endpoints = [...extraEndpoints, endpoint(port)];
      const status = await call(port, ["api", "call", "server.status"]);
      const hostId = parseJson(status.stdout)?.host_id;
      if (status.code !== 0 || !hostId) throw new Error("Could not read the sandbox's Rex host id; the Rex apps ignore hosts without one.");
      const listed = parseJson((await run("rex", ["api", "call", "hosts.list"])).stdout);
      if (!listed?.hosts) throw new Error("rex hosts.list returned output boat-offload could not read.");
      const existing = listed.hosts.find((host) => host.label.toLowerCase() === label.toLowerCase());
      const sharing = listed.hosts.find((host) => (host.endpoints ?? []).some((candidate) => extraEndpoints.includes(candidate)));
      const match = sharing ?? existing;
      const host = { label: match?.label ?? label, endpoints, host_id: hostId, icon: "globe" };
      if (match) host.id = match.id;
      const result = await run("rex", ["api", "call", "hosts.put", JSON.stringify({ host })]);
      if (result.code !== 0) throw new Error(`rex hosts.put failed: ${result.stderr.trim().split("\n").pop()}`);
      if (existing && sharing && existing.id !== sharing.id) await run("rex", ["api", "call", "hosts.remove", JSON.stringify({ id: existing.id })]);
    },
    async removeHost(label) {
      await run("rex", ["hosts", "remove", label]);
    },
    async hasSession(port, label) {
      const result = await call(port, ["ls", "--json"]);
      if (result.code !== 0) throw new Error("rex ls failed; cannot tell whether the Rex session already exists.");
      try {
        return JSON.parse(result.stdout).sessions.some((session) => session.label === label);
      } catch {
        throw new Error("rex ls returned output boat-offload could not read.");
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
