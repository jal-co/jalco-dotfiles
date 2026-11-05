import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function loadConfig(path = join(homedir(), ".config", "boat-offload", "config.json")) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
  const config = JSON.parse(text);
  const reference = /^op:\/\/[^/\r\n]+\/[^/\r\n]+\/([^/\r\n]+\/)?[^/\r\n]+$/;
  for (const name of ["tailscaleKeyRef", "tailscaleAdminKeyRef"]) {
    if (config[name] !== undefined && !reference.test(config[name])) throw new Error(`${path}: ${name} must be an op:// reference.`);
  }
  return { tailscaleKeyRef: config.tailscaleKeyRef, tailscaleAdminKeyRef: config.tailscaleAdminKeyRef };
}
