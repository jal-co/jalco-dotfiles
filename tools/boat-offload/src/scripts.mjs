export const quote = (value) => `'${String(value).replaceAll("'", `'\\''`)}'`;

export const REMOTE = {
  home: "/home/user",
  work: "/home/user/work",
  tokens: "/home/user/.config/boat-offload",
  pool: "/home/user/.local/share/boat-offload/pi-claude-pool",
  rexPort: 7297,
};

export const tokenPath = (id) => `${REMOTE.tokens}/claude-${id}.token`;

export const prepareScript = () =>
  `set -eu\nmkdir -p ${quote(REMOTE.tokens)} ${quote(REMOTE.work)} ${quote(REMOTE.pool)}\nchmod 700 ${quote(REMOTE.tokens)}`;

const MERGE_PI_CONFIG = `
const fs = require("node:fs");
const [accountsJson, plan, today] = process.argv.slice(1);
const dir = process.env.HOME + "/.pi/agent";
fs.mkdirSync(dir, { recursive: true });
const read = (name) => { try { return JSON.parse(fs.readFileSync(dir + "/" + name, "utf8")); } catch { return {}; } };
const write = (name, value) => fs.writeFileSync(dir + "/" + name, JSON.stringify(value, null, 2) + "\\n", { mode: 0o600 });
const settings = read("settings.json");
const pool = process.env.POOL_DIR;
settings.packages = [...(settings.packages ?? []).filter((entry) => entry !== pool), pool];
settings.defaultProvider = "claude-bridge";
settings.defaultModel = "claude-sonnet-5-5";
settings.enabledModels = ["claude-bridge/claude-opus-5-5", "claude-bridge/claude-sonnet-5-5", "claude-bridge/claude-haiku-5-5"];
write("settings.json", settings);
write("claude-pool.json", { accounts: JSON.parse(accountsJson) });
const bridge = read("claude-bridge.json");
write("claude-bridge.json", { ...bridge, startupNoticeShown: bridge.startupNoticeShown ?? today, provider: { ...bridge.provider, plan } });
`;

export function provisionScript({ owner, repo, branch, gitName, gitEmail, accounts, plan, today }) {
  const checkout = `${REMOTE.work}/${repo}`;
  const accountEntries = JSON.stringify(accounts.map(({ id, file }) => ({ id, tokenFile: file })));
  return [
    "set -eu",
    'export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"',
    "command -v rex >/dev/null || curl -fsSL https://pkgs.superlogical.com/rex/install.sh | sudo sh -s -- --tarball >/dev/null",
    "command -v pi >/dev/null || npm install -g @earendil-works/pi-coding-agent --ignore-scripts --no-audit --no-fund >/dev/null",
    gitName ? `git config --global user.name ${quote(gitName)}` : "",
    gitEmail ? `git config --global user.email ${quote(gitEmail)}` : "",
    `if [ -d ${quote(`${checkout}/.git`)} ]; then`,
    `  cd ${quote(checkout)}`,
    `  git fetch -q origin ${quote(branch)}`,
    `  git checkout -q ${quote(branch)} 2>/dev/null || git checkout -q -b ${quote(branch)} ${quote(`origin/${branch}`)}`,
    `  git merge -q --ff-only ${quote(`origin/${branch}`)} || echo "note: ${branch} on the sandbox has diverged from origin; left as is"`,
    "else",
    `  gh repo clone ${quote(`${owner}/${repo}`)} ${quote(checkout)} -- -q --branch ${quote(branch)}`,
    "fi",
    `cd ${quote(REMOTE.pool)}`,
    "npm ci --ignore-scripts --legacy-peer-deps --no-audit --no-fund >/dev/null",
    `chmod 600 ${accounts.map(({ file }) => quote(file)).join(" ")}`,
    `POOL_DIR=${quote(REMOTE.pool)} node -e ${quote(MERGE_PI_CONFIG)} ${quote(accountEntries)} ${quote(plan)} ${quote(today)}`,
    "echo provisioned",
  ].filter(Boolean).join("\n");
}

export const rexStartScript = ({ tailscale }) =>
  [
    "set -eu",
    'export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"',
    `rex server start --extra-listen 127.0.0.1:${REMOTE.rexPort} --allow-anonymous >/dev/null`,
    tailscale
      ? `rex server tailscale on --hostname ${quote(tailscale.hostname)} --auth-key-file ${quote(tailscale.keyFile)} --json >/dev/null && rm -f ${quote(tailscale.keyFile)}`
      : "",
    "echo rex-ready",
  ].filter(Boolean).join("\n");

export const listeningScript = (port) => `ss -ltn "( sport = :${Number(port)} )" | grep -q LISTEN && echo listening || echo waiting`;

export const gitSummaryScript = (repo) =>
  `cd ${quote(`${REMOTE.work}/${repo}`)} && git status --short --branch | head -20 && git log --oneline -5`;
