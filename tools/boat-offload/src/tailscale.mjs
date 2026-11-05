const API = "https://api.tailscale.com/api/v2";

export function createTailscale(readKey, request = fetch) {
  async function call(path, method = "GET") {
    const key = await readKey();
    return request(`${API}${path}`, { method, headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
  }

  return {
    async removeDevice(address) {
      const name = new URL(address).hostname;
      const listed = await call("/tailnet/-/devices?fields=default");
      if (!listed.ok) throw new Error(`Tailscale device list failed: HTTP ${listed.status}`);
      const matches = (await listed.json()).devices.filter((device) => device.name === name && device.os === "linux");
      for (const device of matches) {
        const deleted = await call(`/device/${encodeURIComponent(device.nodeId ?? device.id)}`, "DELETE");
        if (!deleted.ok) throw new Error(`Tailscale device delete failed: HTTP ${deleted.status}`);
      }
      return matches.length;
    },
  };
}
