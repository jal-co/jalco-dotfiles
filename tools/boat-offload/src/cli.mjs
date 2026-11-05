import { parseArgs } from "node:util";
import { createAccounts } from "./accounts.mjs";
import { createBoat } from "./boat.mjs";
import { attach, down, extend, offloadSession, overview, phone, preview, summary, up } from "./commands.mjs";
import { freePort } from "./free-port.mjs";
import { isForwarding, startForward, stopForward } from "./forward.mjs";
import { createRex, endpoint } from "./rex.mjs";
import { inspectRepo } from "./repo.mjs";
import { loadConfig } from "./config.mjs";
import { newestSession, sessionDirectory } from "./session.mjs";
import { run } from "./runner.mjs";
import { createTailscale } from "./tailscale.mjs";
import { defaultStatePath, loadState, offloadKey, saveState } from "./state.mjs";

const HELP = `boat-offload: run a branch on a Boat sandbox with Rex, Pi and your Claude subscriptions

Usage (run inside the repository):
  boat-offload up [--type small|default] [--dev "command"] [--preview PORT] [--plan pro|max] [--tailscale-key op://...] [--no-tailnet] [--hours N]
  boat-offload status
  boat-offload extend HOURS
  boat-offload attach
  boat-offload preview PORT
  boat-offload phone [--wait SECONDS]
  boat-offload session [--session PATH]
  boat-offload down [--delete]

up         create or reuse the sandbox for this branch, install tools, deliver tokens, start Pi in Rex
attach     reconnect Rex to a running or stopped sandbox for this branch
preview    print a private HTTPS URL for a port on the sandbox
phone      finish tailnet sign-in for the sandbox's Rex server (up already starts it)
session    fork a Pi session (default: the newest one for this repository) onto the sandbox
down       stop the sandbox (kept 14 days); --delete removes it
status     list offloads with state, cost so far and auto-stop time; flags other running sandboxes
extend     set how many more hours the sandbox may run before it stops itself
`;

const OPTIONS = {
  type: { type: "string", default: "small" },
  dev: { type: "string" },
  preview: { type: "string" },
  plan: { type: "string", default: "max" },
  "tailscale-key": { type: "string" },
  delete: { type: "boolean", default: false },
  wait: { type: "string", default: "300" },
  hours: { type: "string", default: "1" },
  session: { type: "string" },
  "no-tailnet": { type: "boolean", default: false },
  help: { type: "boolean", short: "h", default: false },
};

function parseSeconds(value) {
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) throw new Error(`"${value}" is not a number of seconds between 1 and 3600.`);
  return seconds;
}

function parseHours(value) {
  const hours = Number(value);
  if (!Number.isInteger(hours) || hours < 1 || hours > 12) throw new Error(`"${value}" is not a whole number of hours between 1 and 12.`);
  return hours;
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`"${value}" is not a port.`);
  return port;
}

async function main(argv) {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  const [command = "help", ...rest] = positionals;
  if (values.help || command === "help") {
    process.stdout.write(HELP);
    return 0;
  }
  if (!["small", "default"].includes(values.type)) throw new Error("--type must be small or default.");
  if (!["pro", "max"].includes(values.plan)) throw new Error("--plan must be pro or max.");

  const config = loadConfig();
  const statePath = defaultStatePath();
  const state = loadState(statePath);
  const log = (message) => process.stdout.write(`${message}\n`);
  const boat = createBoat(run);
  const rex = createRex(run);
  const repoInfo = () => inspectRepo(run, process.cwd());
  const accounts = createAccounts();
  const deps = {
    run, boat, rex, state, log, repoInfo, freePort,
    saveState: (value) => saveState(statePath, value),
    accounts,
    tailscale: config.tailscaleAdminKeyRef ? createTailscale(() => accounts.readSecret(config.tailscaleAdminKeyRef)) : undefined,
    forward: { start: startForward, stop: stopForward, isForwarding: (pid, id) => isForwarding(run, pid, id) },
    now: () => new Date().toISOString(),
    today: () => new Date().toISOString().slice(0, 10),
  };

  if (command === "status") {
    await overview(deps);
    return 0;
  }

  const repo = await repoInfo();
  const key = offloadKey(repo);
  const entry = state.offloads[key];
  const needEntry = () => {
    if (!entry) throw new Error(`Nothing is offloaded for ${key}. Run boat-offload up first.`);
    return entry;
  };

  if (command === "up") {
    const result = await up(deps, {
      type: values.type, plan: values.plan, dev: values.dev, hours: parseHours(values.hours),
      preview: values.preview ? parsePort(values.preview) : undefined,
      tailscaleKeyRef: values["tailscale-key"] ?? config.tailscaleKeyRef,
      tailnet: !values["no-tailnet"],
    });
    log(`\nSandbox ${result.id} is running ${repo.owner}/${repo.repo}@${repo.branch}`);
    log(`Rex CLI host: ${result.label}  (rex -S ${result.label} ls)`);
    log(result.phoneAddress
      ? `Rex app (Mac or phone): Add Remote Host with ${result.phoneAddress}`
      : `Rex app on this Mac: Add Remote Host with ${endpoint(result.localPort)}. Phone: run boat-offload phone, then add the tailnet address it prints.`);
    const pairing = await rex.phonePairing();
    if (pairing) log(`Phone: Rex on your phone is not connected to this Mac yet. Connect it once to ${pairing} (rex server tailscale pair shows a QR code). Every sandbox then appears in its host list on its own.`);
    if (result.previewUrl) log(`Preview: ${result.previewUrl}`);
    log(`Next: boat-offload preview PORT for a frontend URL, boat-offload down when finished.`);
    return 0;
  }
  if (command === "attach") {
    const result = await attach(deps, needEntry());
    log(`Rex host ${result.label} reconnected at ${endpoint(result.localPort)}`);
    const text = await summary(deps, result);
    if (text) log(text);
    return 0;
  }
  if (command === "extend") {
    await extend(deps, needEntry(), parseHours(rest[0] ?? values.hours));
    return 0;
  }
  if (command === "preview") {
    if (!rest[0]) throw new Error("Usage: boat-offload preview PORT");
    log(await preview(deps, needEntry(), parsePort(rest[0])));
    return 0;
  }
  if (command === "phone") {
    const address = await phone(deps, needEntry(), { waitSeconds: parseSeconds(values.wait) });
    log(`Rex app (Mac or phone): Add Remote Host with ${address}`);
    return 0;
  }
  if (command === "session") {
    const path = values.session ?? newestSession(sessionDirectory(repo.root));
    log(`Session: ${path}`);
    const label = await offloadSession(deps, needEntry(), path);
    log(`Open it with: rex -S ${needEntry().label} ls  (session ${label})`);
    return 0;
  }
  if (command === "down") {
    await down(deps, key, needEntry(), { remove: values.delete });
    return 0;
  }
  throw new Error(`Unknown command "${command}". Run boat-offload help.`);
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (error) => {
    process.stderr.write(`boat-offload: ${error.message}\n`);
    process.exitCode = 1;
  },
);
