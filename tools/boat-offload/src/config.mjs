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
  const reference = config.tailscaleKeyRef;
  if (reference !== undefined && !/^op:\/\/[^/\r\n]+\/[^/\r\n]+\/([^/\r\n]+\/)?[^/\r\n]+$/.test(reference)) {
    throw new Error(`${path}: tailscaleKeyRef must be an op:// reference.`);
  }
  return { tailscaleKeyRef: reference };
}
