export const quote = (value) => `'${String(value).replaceAll("'", `'\\''`)}'`;

export const REMOTE = {
  home: "/home/user",
  work: "/home/user/work",
  sessions: "/home/user/.local/share/boat-offload/sessions",
  tokens: "/home/user/.config/boat-offload",
  dotfiles: "/home/user/dotfiles",
  sync: "/home/user/.local/share/boat-offload/sync-pi.cjs",
  rexPort: 7297,
};

export const tokenPath = (id) => `${REMOTE.tokens}/claude-${id}.token`;

export const prepareScript = () =>
  `set -eu\nmkdir -p ${quote(REMOTE.tokens)} ${quote(REMOTE.work)} ${quote(REMOTE.dotfiles)}\nchmod 700 ${quote(REMOTE.tokens)}`;

export function provisionScript({ owner, repo, branch, gitName, gitEmail, accounts, plan, today }) {
  const checkout = `${REMOTE.work}/${repo}`;
  const piAgent = `${REMOTE.dotfiles}/pi/agent`;
  const accountEntries = JSON.stringify(accounts.map(({ id, file }) => ({ id, tokenFile: file })));
  return [
    "set -eu",
    'export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"',
    'quietly() { log=$(mktemp); if ! "$@" >"$log" 2>&1; then tail -n 8 "$log" >&2; exit 1; fi; rm -f "$log"; }',
    "command -v rex >/dev/null || quietly sh -c 'curl -fsSL https://pkgs.superlogical.com/rex/install.sh | sudo sh -s -- --tarball'",
    "command -v pi >/dev/null || quietly npm install -g @earendil-works/pi-coding-agent --ignore-scripts --no-audit --no-fund",
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
    `for dir in ${quote(`${piAgent}/packages/pi-claude-pool`)} ${quote(`${piAgent}/extensions`)} ${quote(`${REMOTE.dotfiles}/tools/anti-slop`)}; do`,
    '  (cd "$dir" && quietly npm ci --ignore-scripts --legacy-peer-deps --no-audit --no-fund)',
    "done",
    `chmod 600 ${accounts.map(({ file }) => quote(file)).join(" ")}`,
    `node ${quote(REMOTE.sync)} --dotfiles ${quote(REMOTE.dotfiles)} --home "$HOME" --accounts ${quote(accountEntries)} --plan ${quote(plan)} --today ${quote(today)}`,
    "pi update --extensions >/dev/null 2>&1 || echo \"note: pi update --extensions did not finish; packages install on first use\"",
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

const REX_PATH = 'export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"';

export const tailscaleOnScript = (hostname) =>
  `${REX_PATH}\nrex server tailscale on --hostname ${quote(hostname)} --json`;

export const tailscaleStatusScript = () => `${REX_PATH}\nrex server status --json`;

export const tailscalePairScript = () => `${REX_PATH}\nrex server tailscale pair --json`;

export const tailscaleRenameScript = (hostname) =>
  `${REX_PATH}\nrex server tailscale rename ${quote(hostname)} --json`;

export const tailscaleLogoutScript = () => `${REX_PATH}\nrex server tailscale logout --json`;
