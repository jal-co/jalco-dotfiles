import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const forwardLog = (home = homedir()) => join(home, ".local", "state", "boat-offload", "forward.log");

export function startForward(id, localPort, remotePort, logPath = forwardLog()) {
  const log = openSync(logPath, "a", 0o600);
  const child = spawn("boat", ["forward", id, "--remote", String(remotePort), "--local", String(localPort), "--no-update"], {
    detached: true,
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  child.unref();
  return child.pid;
}

export function isForwarding(run, pid, id) {
  if (!pid) return Promise.resolve(false);
  return run("ps", ["-o", "command=", "-p", String(pid)]).then((result) => result.code === 0 && result.stdout.includes("boat forward") && result.stdout.includes(id));
}

export function stopForward(pid) {
  if (!pid) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}
