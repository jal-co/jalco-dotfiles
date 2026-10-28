import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { browserArguments, readTicket, supportDirectory } from "./bridge.mjs";

try {
  const ticket = readTicket(process.argv[2]);
  const { rex, browser } = JSON.parse(readFileSync(join(supportDirectory, "programs.json"), "utf8"));
  execFileSync(rex, ["--server", ticket.server, "block", "inspect", ticket.block, "--session", ticket.session, "--json"], { timeout: 10000, stdio: ["ignore", "pipe", "pipe"] });
  process.stdout.write(execFileSync(rex, browserArguments(ticket, browser), { timeout: 15000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
} catch (error) {
  process.stderr.write(`Rex Markdown: ${error.stderr?.toString().trim() || error.message}\n`);
  process.exitCode = 1;
}
