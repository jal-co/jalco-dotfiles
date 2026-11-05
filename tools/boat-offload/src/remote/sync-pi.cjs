const fs = require("node:fs");
const path = require("node:path");

const KEEP = new Set(["settings.json", "mcp.json"]);
const MERGED = new Set(["skills", "extensions"]);
const MAC_ONLY_EXTENSIONS = new Set(["rex-markdown.ts", "white-logo-header.ts"]);
const PROVIDER = "claude-bridge";

function parse(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 2) out[argv[index].replace(/^--/, "")] = argv[index + 1];
  return out;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function link(target, destination) {
  let existing;
  try {
    existing = fs.lstatSync(destination);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (existing?.isSymbolicLink()) fs.unlinkSync(destination);
  else if (existing) return false;
  fs.symlinkSync(target, destination);
  return true;
}

function linkChildren(source, destination, exclude = new Set()) {
  fs.mkdirSync(destination, { recursive: true });
  let skipped = 0;
  for (const name of fs.readdirSync(source)) {
    if (exclude.has(name)) continue;
    if (!link(path.join(source, name), path.join(destination, name))) skipped++;
  }
  return skipped;
}

function sync({ dotfiles, home, accounts, plan, today }) {
  const source = path.join(dotfiles, "pi", "agent");
  const agentDir = path.join(home, ".pi", "agent");
  fs.mkdirSync(agentDir, { recursive: true });
  const skipped = [];
  for (const name of fs.readdirSync(source)) {
    if (KEEP.has(name)) continue;
    const from = path.join(source, name);
    const to = path.join(agentDir, name);
    if (MERGED.has(name)) {
      if (fs.lstatSync(to, { throwIfNoEntry: false })?.isSymbolicLink()) fs.unlinkSync(to);
      if (linkChildren(from, to, name === "extensions" ? MAC_ONLY_EXTENSIONS : undefined)) skipped.push(name);
    } else if (!link(from, to)) skipped.push(name);
  }

  const settings = readJson(path.join(source, "settings.json"), {});
  const models = (settings.enabledModels ?? []).filter((model) => model.startsWith(`${PROVIDER}/`));
  const first = models[0] ?? `${PROVIDER}/claude-sonnet-5-5`;
  const preferred = models.find((model) => model.endsWith("/claude-sonnet-5-5")) ?? first;
  writeJson(path.join(agentDir, "settings.json"), {
    ...settings,
    defaultProvider: PROVIDER,
    defaultModel: preferred.slice(PROVIDER.length + 1),
    enabledModels: models,
  });

  const servers = { ...readJson(path.join(agentDir, "mcp.json"), {}).mcpServers, ...readJson(path.join(source, "mcp.json"), {}).mcpServers };
  writeJson(path.join(agentDir, "mcp.json"), { ...readJson(path.join(source, "mcp.json"), {}), mcpServers: servers });

  writeJson(path.join(agentDir, "claude-pool.json"), { accounts });
  const bridge = readJson(path.join(agentDir, "claude-bridge.json"), {});
  writeJson(path.join(agentDir, "claude-bridge.json"), { ...bridge, startupNoticeShown: bridge.startupNoticeShown ?? today, provider: { ...bridge.provider, plan } });

  const agents = path.join(dotfiles, "agents");
  if (fs.existsSync(agents) && !link(agents, path.join(home, ".agents"))) skipped.push(".agents");
  return skipped;
}

if (require.main === module) {
  const args = parse(process.argv.slice(2));
  const skipped = sync({ dotfiles: args.dotfiles, home: args.home, accounts: JSON.parse(args.accounts), plan: args.plan, today: args.today });
  if (skipped.length) process.stdout.write(`kept existing: ${skipped.join(", ")}\n`);
}

module.exports = { sync };
