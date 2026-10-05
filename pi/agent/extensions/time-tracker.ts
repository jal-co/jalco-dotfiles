/**
 * time-tracker: tracks active agent working time per project for freelance billing.
 *
 * Counts time when pi is actively working (prompt submitted -> agent settled),
 * plus short gaps between runs (idle grace period, default 5 min) to cover
 * reading output and typing your next prompt. Long idle stretches while the
 * agent waits on you are NOT counted.
 *
 * Data: ~/.pi/agent/time-tracking.json
 *   { [projectPath]: { [YYYY-MM-DD]: seconds } }
 *
 * Commands:
 *   /time            - summary for current project (today, this week, total)
 *   /time all        - summary for all projects
 *   /time days       - per-day breakdown for current project
 *   /time reset      - reset current project's tracked time (with confirm)
 *   /time grace <m>  - set idle grace period in minutes (0 disables)
 *   /time add <dur> [date] - manually add time, e.g. /time add 1h30m 2026-02-05
 *   /time sub <dur> [date] - manually remove time, e.g. /time sub 30m 2026-02-05
 *   /time assign <client>  - tag this project with a client (bare shows current, 'clear' unassigns)
 *   /time clients          - tracked time grouped by client (with unbilled)
 *   /time export     - export current project's hours to time-export.json in cwd
 *   /time export all - export every project's hours
 *
 * Invoicing (billed ledger in ~/.pi/agent/time-invoices.json):
 *   /time unbilled          - unbilled hours for current project
 *   /time unbilled all      - unbilled hours across all projects
 *   /time invoice [label]   - snapshot current project's unbilled time into an
 *                             invoice, mark it billed, write invoice JSON to cwd
 *   /time invoice all [label] - same, combining every project's unbilled time
 *   /time invoices          - list past invoices
 *
 * TUI:
 *   /time ui  - interactive dashboard (tabs: Summary / Days / Projects / Clients / Invoices)
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { matchesKey, Key, truncateToWidth, type AutocompleteItem } from "@earendil-works/pi-tui";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const DATA_FILE = join(homedir(), ".pi", "agent", "time-tracking.json");
const CONFIG_FILE = join(homedir(), ".pi", "agent", "time-tracker.config.json");
const CLIENTS_FILE = join(homedir(), ".pi", "agent", "time-clients.json");
const DEFAULT_GRACE_MINUTES = 5;

function loadGraceMs(): number {
  try {
    const cfg = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
    const m = Number(cfg.idleGraceMinutes);
    if (Number.isFinite(m) && m >= 0) return m * 60_000;
  } catch {}
  return DEFAULT_GRACE_MINUTES * 60_000;
}

function saveGraceMinutes(minutes: number) {
  mkdirSync(dirname(CONFIG_FILE), { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify({ idleGraceMinutes: minutes }, null, 2));
}

type Store = Record<string, Record<string, number>>; // project -> date -> seconds
type Clients = Record<string, string>; // project -> client name

function loadClients(): Clients {
  try {
    return JSON.parse(readFileSync(CLIENTS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveClients(clients: Clients) {
  mkdirSync(dirname(CLIENTS_FILE), { recursive: true });
  writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
}

const INVOICES_FILE = join(homedir(), ".pi", "agent", "time-invoices.json");

interface Invoice {
  id: string; // e.g. INV-2026-001
  label?: string;
  createdAt: string;
  totalSeconds: number;
  totalHours: number;
  projects: Record<string, Record<string, number>>; // project -> date -> seconds billed
}

function loadInvoices(): Invoice[] {
  try {
    return JSON.parse(readFileSync(INVOICES_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveInvoices(invoices: Invoice[]) {
  mkdirSync(dirname(INVOICES_FILE), { recursive: true });
  writeFileSync(INVOICES_FILE, JSON.stringify(invoices, null, 2));
}

// Billed seconds per project/date, aggregated across all invoices.
function billedMap(invoices: Invoice[]): Store {
  const billed: Store = {};
  for (const inv of invoices) {
    for (const [project, days] of Object.entries(inv.projects)) {
      billed[project] ??= {};
      for (const [d, s] of Object.entries(days)) {
        billed[project][d] = (billed[project][d] ?? 0) + s;
      }
    }
  }
  return billed;
}

// Unbilled seconds per date for one project.
function unbilledDays(
  tracked: Record<string, number>,
  billed: Record<string, number> | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [d, s] of Object.entries(tracked)) {
    const remaining = s - (billed?.[d] ?? 0);
    if (remaining > 0.5) out[d] = remaining;
  }
  return out;
}

function sumDays(days: Record<string, number>): number {
  return Object.values(days).reduce((a, b) => a + b, 0);
}

interface ClientRollup {
  client: string;
  totalSeconds: number;
  unbilledSeconds: number;
  projects: string[];
}

// Aggregate tracked time by client. Projects with no client fall under "(unassigned)".
function rollupByClient(
  store: Store,
  clients: Clients,
  billed: Store,
  extra: { project: string; seconds: number } | undefined,
): ClientRollup[] {
  const map = new Map<string, ClientRollup>();
  for (const [project, days] of Object.entries(store)) {
    const client = clients[project] ?? "(unassigned)";
    const add = extra && extra.project === project ? extra.seconds : 0;
    const withLive =
      add > 0 ? { ...days, [dateKey()]: (days[dateKey()] ?? 0) + add } : days;
    const total = sumDays(days) + add;
    const unbilled = sumDays(unbilledDays(withLive, billed[project]));
    const r = map.get(client) ?? { client, totalSeconds: 0, unbilledSeconds: 0, projects: [] };
    r.totalSeconds += total;
    r.unbilledSeconds += unbilled;
    r.projects.push(project);
    map.set(client, r);
  }
  return [...map.values()].sort((a, b) => b.totalSeconds - a.totalSeconds);
}

function nextInvoiceId(invoices: Invoice[]): string {
  const year = new Date().getFullYear();
  const n = invoices.filter((i) => i.id.includes(`-${year}-`)).length + 1;
  return `INV-${year}-${String(n).padStart(3, "0")}`;
}

function loadStore(): Store {
  try {
    return JSON.parse(readFileSync(DATA_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveStore(store: Store) {
  mkdirSync(dirname(DATA_FILE), { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

function dateKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function fmt(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function weekStart(d = new Date()): string {
  const day = d.getDay(); // 0 = Sunday
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((day + 6) % 7));
  return dateKey(monday);
}

export default function (pi: ExtensionAPI) {
  let activeStart: number | undefined; // ms timestamp when the current active block began
  let lastSettledAt: number | undefined; // ms timestamp of the last agent_settled
  let sessionSeconds = 0; // accrued this pi session (for status display)
  let graceMs = loadGraceMs();

  // Persist the current active block and close it.
  function accrue(project: string) {
    if (activeStart === undefined) return 0;
    const elapsed = (Date.now() - activeStart) / 1000;
    activeStart = undefined;
    if (elapsed <= 0) return 0;
    const store = loadStore();
    const day = dateKey();
    store[project] ??= {};
    store[project][day] = (store[project][day] ?? 0) + elapsed;
    saveStore(store);
    sessionSeconds += elapsed;
    return elapsed;
  }

  // Live seconds in the current running (not yet persisted) block.
  function liveSeconds(): number {
    if (activeStart === undefined) return 0;
    return Math.max(0, (Date.now() - activeStart) / 1000);
  }

  function updateStatus(ctx: { ui: { setStatus: (k: string, v: string | null) => void }; cwd: string }) {
    const store = loadStore();
    const today = store[ctx.cwd]?.[dateKey()] ?? 0;
    ctx.ui.setStatus("time-tracker", `⏱ today ${fmt(today + liveSeconds())}`);
  }

  pi.on("agent_start", async (_event, ctx) => {
    const now = Date.now();
    if (activeStart === undefined) {
      // Credit the idle gap retroactively if it was within the grace period.
      activeStart =
        lastSettledAt !== undefined && now - lastSettledAt <= graceMs ? lastSettledAt : now;
      lastSettledAt = undefined;
    }
    updateStatus(ctx);
  });

  pi.on("agent_settled", async (_event, ctx) => {
    // Persist immediately so the ledger on disk is always current.
    accrue(ctx.cwd);
    lastSettledAt = Date.now();
    updateStatus(ctx);
  });

  // Flush on shutdown / session switch so a killed run isn't lost.
  pi.on("session_shutdown", async (_event, ctx) => {
    accrue(ctx.cwd);
  });

  pi.on("session_start", async (_event, ctx) => {
    updateStatus(ctx);
  });

  // Interactive TUI dashboard
  class TimeDashboard {
    private tab = 0;
    private tabs = ["Summary", "Days", "Projects", "Clients", "Invoices"];
    private cached?: { width: number; lines: string[] };
    private sel = 0; // selected row on the Projects tab
    private editing = false; // inline client-name edit on the Projects tab
    private buffer = "";

    constructor(
      private cwd: string,
      private theme: { fg: (c: string, s: string) => string; bold: (s: string) => string },
      private live: () => number,
      private done: (v: undefined) => void,
    ) {}

    private projectList(): string[] {
      return Object.keys(loadStore());
    }

    handleInput(data: string): void {
      // Inline client-name editor (Projects tab) owns input while active.
      if (this.editing) {
        if (matchesKey(data, Key.escape)) {
          this.editing = false;
          this.buffer = "";
        } else if (matchesKey(data, Key.enter)) {
          const project = this.projectList()[this.sel];
          if (project) {
            const clients = loadClients();
            const name = this.buffer.trim();
            if (name) clients[project] = name;
            else delete clients[project];
            saveClients(clients);
          }
          this.editing = false;
          this.buffer = "";
        } else if (matchesKey(data, Key.backspace)) {
          this.buffer = this.buffer.slice(0, -1);
        } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
          this.buffer += data;
        } else {
          return;
        }
        this.invalidate();
        return;
      }

      if (matchesKey(data, Key.escape) || data === "q") {
        this.done(undefined);
        return;
      }

      // Projects tab: row selection + assign.
      if (this.tab === 2) {
        const list = this.projectList();
        if (matchesKey(data, Key.up)) {
          this.sel = (this.sel + list.length - 1) % Math.max(1, list.length);
          this.invalidate();
          return;
        }
        if (matchesKey(data, Key.down)) {
          this.sel = (this.sel + 1) % Math.max(1, list.length);
          this.invalidate();
          return;
        }
        if ((data === "a" || matchesKey(data, Key.enter)) && list[this.sel]) {
          this.editing = true;
          this.buffer = loadClients()[list[this.sel]] ?? "";
          this.invalidate();
          return;
        }
      }

      if (matchesKey(data, Key.right) || matchesKey(data, Key.tab)) {
        this.tab = (this.tab + 1) % this.tabs.length;
      } else if (matchesKey(data, Key.left)) {
        this.tab = (this.tab + this.tabs.length - 1) % this.tabs.length;
      } else if (/^[1-5]$/.test(data)) {
        this.tab = Number(data) - 1;
      } else {
        return;
      }
      this.invalidate();
    }

    private body(): string[] {
      const t = this.theme;
      const store = loadStore();
      const invoices = loadInvoices();
      const billed = billedMap(invoices);
      const live = this.live();
      const days = { ...(store[this.cwd] ?? {}) };
      if (live > 0) days[dateKey()] = (days[dateKey()] ?? 0) + live;

      if (this.tab === 0) {
        const ws = weekStart();
        const today = days[dateKey()] ?? 0;
        const week = Object.entries(days)
          .filter(([d]) => d >= ws)
          .reduce((a, [, s]) => a + s, 0);
        const total = sumDays(days);
        const unbilled = sumDays(unbilledDays(days, billed[this.cwd]));
        const row = (label: string, v: string, hl = false) =>
          `  ${t.fg("muted", label.padEnd(12))} ${hl ? t.fg("accent", v) : v}`;
        const client = loadClients()[this.cwd];
        return [
          `  ${t.fg("dim", this.cwd)}`,
          ...(client ? [`  ${t.fg("muted", "Client".padEnd(12))} ${t.fg("accent", client)}`] : []),
          "",
          row("Today", fmt(today), true),
          row("This week", fmt(week)),
          row("All time", fmt(total)),
          "",
          row("Unbilled", `${fmt(unbilled)} (${(unbilled / 3600).toFixed(2)}h)`, unbilled > 0),
          row("Billed", fmt(total - unbilled)),
        ];
      }

      if (this.tab === 1) {
        const entries = Object.entries(days).sort(([a], [b]) => b.localeCompare(a));
        if (entries.length === 0) return [`  ${t.fg("dim", "No time tracked for this project.")}`];
        return entries.slice(0, 14).map(([d, s]) => {
          const billedS = billed[this.cwd]?.[d] ?? 0;
          const un = Math.max(0, s - billedS);
          const bar = t.fg("accent", "\u2593".repeat(Math.min(24, Math.max(1, Math.round(s / 1800)))));
          const tag = un > 0.5 ? t.fg("warning", " unbilled") : t.fg("success", " billed");
          return `  ${d}  ${fmt(s).padEnd(8)} ${bar}${tag}`;
        });
      }

      if (this.tab === 2) {
        const clients = loadClients();
        const entries = Object.entries(store);
        if (entries.length === 0) return [`  ${t.fg("dim", "No time tracked yet.")}`];
        if (this.sel >= entries.length) this.sel = entries.length - 1;
        const rows = entries.map(([project, pdays], i) => {
          const extra = project === this.cwd ? live : 0;
          const total = sumDays(pdays) + extra;
          const un = sumDays(
            unbilledDays(
              extra > 0 ? { ...pdays, [dateKey()]: (pdays[dateKey()] ?? 0) + extra } : pdays,
              billed[project],
            ),
          );
          const selected = i === this.sel;
          const mark = selected ? t.fg("accent", "\u276f ") : "  ";
          const unTag = t.fg("warning", un > 0.5 ? `${(un / 3600).toFixed(2)}h unbilled` : "").padEnd(14);
          let tag: string;
          if (selected && this.editing) {
            tag = `  ${t.fg("muted", "client:")} ${t.fg("accent", this.buffer + "\u2588")}`;
          } else {
            tag = clients[project] ? t.fg("dim", ` [${clients[project]}]`) : "";
          }
          const name = selected ? t.bold(project) : project;
          return `${mark}${fmt(total).padStart(8)}  ${unTag}  ${name}${tag}`;
        });
        const hint = this.editing
          ? `  ${t.fg("dim", "type client \u00b7 enter save \u00b7 empty+enter clears \u00b7 esc cancel")}`
          : `  ${t.fg("dim", "\u2191\u2193 select \u00b7 a/enter assign client")}`;
        return [...rows, "", hint];
      }

      if (this.tab === 3) {
        const rollups = rollupByClient(store, loadClients(), billed, live > 0 ? { project: this.cwd, seconds: live } : undefined);
        if (rollups.length === 0) return [`  ${t.fg("dim", "No time tracked yet.")}`];
        return rollups.map((r) => {
          const un = r.unbilledSeconds;
          const unTag = t.fg("warning", un > 0.5 ? `${(un / 3600).toFixed(2)}h unbilled` : "").padEnd(14);
          const name = r.client === "(unassigned)" ? t.fg("dim", r.client) : t.fg("accent", r.client);
          return `  ${fmt(r.totalSeconds).padStart(8)}  ${unTag}  ${name} ${t.fg("dim", `(${r.projects.length})`)}`;
        });
      }

      const rows = loadInvoices().map(
        (i) =>
          `  ${t.fg("accent", i.id)}  ${i.createdAt.slice(0, 10)}  ${String(i.totalHours.toFixed(2)).padStart(6)}h  ${Object.keys(i.projects).length} project(s)${i.label ? `  ${t.fg("dim", `\"${i.label}\"`)}` : ""}`,
      );
      return rows.length ? rows : [`  ${t.fg("dim", "No invoices yet.")}`];
    }

    render(width: number): string[] {
      if (this.cached?.width === width) return this.cached.lines;
      const t = this.theme;
      const rule = new DynamicBorder((s: string) => t.fg("borderAccent", s));
      const header = this.tabs
        .map((name, i) => (i === this.tab ? t.bold(t.fg("accent", ` ${name} `)) : t.fg("dim", ` ${name} `)))
        .join(t.fg("dim", "\u2502"));
      const lines = [
        ...rule.render(width),
        `  \u23f1 ${t.bold("Time Tracker")}   ${header}`,
        "",
        ...this.body(),
        "",
        `  ${t.fg("dim", "\u2190/\u2192 or 1-5 switch \u00b7 q/esc close \u00b7 /time invoice to bill")}`,
        ...rule.render(width),
      ].map((l) => truncateToWidth(l, width));
      this.cached = { width, lines };
      return lines;
    }

    invalidate(): void {
      this.cached = undefined;
    }
  }

  const SUBCOMMANDS = [
    { value: "ui", label: "ui", description: "Interactive dashboard" },
    { value: "all", label: "all", description: "Totals across all projects" },
    { value: "days", label: "days", description: "Per-day breakdown" },
    { value: "unbilled", label: "unbilled", description: "Unbilled time (add 'all' for every project)" },
    { value: "invoice", label: "invoice", description: "Create invoice from unbilled time" },
    { value: "invoices", label: "invoices", description: "List past invoices" },
    { value: "add", label: "add", description: "Manually add time, e.g. add 1h30m" },
    { value: "sub", label: "sub", description: "Manually remove time, e.g. sub 30m" },
    { value: "assign", label: "assign", description: "Tag this project with a client" },
    { value: "clients", label: "clients", description: "Time grouped by client" },
    { value: "export", label: "export", description: "Write time-export.json" },
    { value: "grace", label: "grace", description: "Show/set idle grace period" },
    { value: "reset", label: "reset", description: "Reset this project's time" },
  ];

  pi.registerCommand("time", {
    description: "Show tracked active time (freelance hours). Args: ui | all | days | unbilled | invoice | invoices | add | sub | assign | clients | export | grace | reset",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const filtered = SUBCOMMANDS.filter((i) => i.value.startsWith(prefix.trim()));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const arg = (args ?? "").trim();

      if (arg === "ui" || (arg === "" && ctx.mode === "tui")) {
        if (ctx.mode !== "tui") {
          ctx.ui.notify("Dashboard requires interactive mode. Use /time summary output instead.", "warning");
          return;
        }
        await ctx.ui.custom(
          (tui: any, theme: any, _keybindings: any, done: (v: undefined) => void) => {
            let timer: ReturnType<typeof setInterval> | undefined;
            const close = (v: undefined) => {
              if (timer) clearInterval(timer);
              done(v);
            };
            const dash = new TimeDashboard(ctx.cwd, theme, liveSeconds, close);
            timer = setInterval(() => {
              dash.invalidate();
              tui.requestRender();
            }, 1000);
            return dash;
          },
          {
            overlay: true,
            overlayOptions: {
              anchor: "center",
              width: "70%",
              minWidth: 54,
              maxHeight: "85%",
            },
          },
        );
        return;
      }
      // include any in-flight time in the view without stopping the clock
      const live = liveSeconds();
      const store = loadStore();

      if (arg.startsWith("grace")) {
        const val = arg.slice(5).trim();
        if (val === "") {
          ctx.ui.notify(`Idle grace period: ${graceMs / 60_000} min`, "info");
          return;
        }
        const minutes = Number(val);
        if (!Number.isFinite(minutes) || minutes < 0) {
          ctx.ui.notify("Usage: /time grace <minutes> (0 disables)", "error");
          return;
        }
        graceMs = minutes * 60_000;
        saveGraceMinutes(minutes);
        ctx.ui.notify(`Idle grace period set to ${minutes} min`, "info");
        return;
      }

      if (arg.startsWith("add")) {
        const parts = arg.slice(3).trim().split(/\s+/).filter(Boolean);
        const durStr = parts[0] ?? "";
        const m = durStr.match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+)m)?$/);
        const seconds = m && durStr ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 : 0;
        if (seconds <= 0) {
          ctx.ui.notify("Usage: /time add <duration> [YYYY-MM-DD]  e.g. /time add 1h30m", "error");
          return;
        }
        const day = parts[1] ?? dateKey();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
          ctx.ui.notify(`Invalid date "${parts[1]}", use YYYY-MM-DD`, "error");
          return;
        }
        store[ctx.cwd] ??= {};
        store[ctx.cwd][day] = (store[ctx.cwd][day] ?? 0) + seconds;
        saveStore(store);
        ctx.ui.notify(`Added ${fmt(seconds)} to ${day} for ${ctx.cwd}`, "info");
        updateStatus(ctx);
        return;
      }

      if (arg.startsWith("assign")) {
        const name = arg.slice(6).trim();
        const clients = loadClients();
        if (name === "") {
          const cur = clients[ctx.cwd];
          ctx.ui.notify(
            cur ? `${ctx.cwd}\n  Client: ${cur}` : `${ctx.cwd}\n  No client assigned. Use /time assign <client>`,
            "info",
          );
          return;
        }
        if (name === "clear" || name === "none") {
          delete clients[ctx.cwd];
          saveClients(clients);
          ctx.ui.notify(`Cleared client for ${ctx.cwd}`, "info");
          return;
        }
        clients[ctx.cwd] = name;
        saveClients(clients);
        ctx.ui.notify(`Assigned ${ctx.cwd} to client "${name}"`, "info");
        return;
      }

      if (arg.startsWith("sub")) {
        const parts = arg.slice(3).trim().split(/\s+/).filter(Boolean);
        const durStr = parts[0] ?? "";
        const m = durStr.match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+)m)?$/);
        const seconds = m && durStr ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 : 0;
        if (seconds <= 0) {
          ctx.ui.notify("Usage: /time sub <duration> [YYYY-MM-DD]  e.g. /time sub 30m", "error");
          return;
        }
        const day = parts[1] ?? dateKey();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
          ctx.ui.notify(`Invalid date "${parts[1]}", use YYYY-MM-DD`, "error");
          return;
        }
        const current = store[ctx.cwd]?.[day] ?? 0;
        if (current <= 0) {
          ctx.ui.notify(`No tracked time on ${day} for ${ctx.cwd}`, "error");
          return;
        }
        const removed = Math.min(seconds, current);
        const remaining = current - removed;
        store[ctx.cwd] ??= {};
        if (remaining > 0.5) {
          store[ctx.cwd][day] = remaining;
        } else {
          delete store[ctx.cwd][day];
        }
        saveStore(store);
        ctx.ui.notify(
          `Removed ${fmt(removed)} from ${day} for ${ctx.cwd} (${fmt(remaining)} left)`,
          "info",
        );
        updateStatus(ctx);
        return;
      }

      if (arg.startsWith("export")) {
        const scope = arg.slice(6).trim();
        const round = (s: number) => Math.round((s / 3600) * 100) / 100;
        const projectExport = (project: string, days: Record<string, number>) => {
          const extra = project === ctx.cwd ? live : 0;
          const daily = Object.fromEntries(
            Object.entries(days)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([d, s]) => [d, { seconds: Math.round(d === dateKey() ? s + extra : s), hours: round(d === dateKey() ? s + extra : s) }]),
          );
          const totalSec = Object.values(days).reduce((a, b) => a + b, 0) + extra;
          return { project, totalSeconds: Math.round(totalSec), totalHours: round(totalSec), daily };
        };

        const invoices = loadInvoices();
        const billed = billedMap(invoices);
        const withBilling = (project: string, days: Record<string, number>) => {
          const extra = project === ctx.cwd ? live : 0;
          const totalSec = Object.values(days).reduce((a, b) => a + b, 0) + extra;
          const unbilledSec = sumDays(
            unbilledDays(
              extra > 0 ? { ...days, [dateKey()]: (days[dateKey()] ?? 0) + extra } : days,
              billed[project],
            ),
          );
          return {
            ...projectExport(project, days),
            billedSeconds: Math.round(totalSec - unbilledSec),
            billedHours: round(totalSec - unbilledSec),
            unbilledSeconds: Math.round(unbilledSec),
            unbilledHours: round(unbilledSec),
          };
        };

        const payload =
          scope === "all"
            ? {
                exportedAt: new Date().toISOString(),
                idleGraceMinutes: graceMs / 60_000,
                projects: Object.entries(store).map(([p, d]) => withBilling(p, d)),
              }
            : {
                exportedAt: new Date().toISOString(),
                idleGraceMinutes: graceMs / 60_000,
                ...withBilling(ctx.cwd, store[ctx.cwd] ?? {}),
              };

        const outPath = join(ctx.cwd, "time-export.json");
        writeFileSync(outPath, JSON.stringify(payload, null, 2));
        ctx.ui.notify(`Exported to ${outPath}`, "info");
        return;
      }

      if (arg === "unbilled" || arg === "unbilled all") {
        const invoices = loadInvoices();
        const billed = billedMap(invoices);
        const scopeAll = arg.endsWith("all");
        const projects = scopeAll ? Object.keys(store) : [ctx.cwd];
        const lines: string[] = [];
        let grand = 0;
        for (const project of projects) {
          const tracked = { ...(store[project] ?? {}) };
          if (project === ctx.cwd && live > 0) tracked[dateKey()] = (tracked[dateKey()] ?? 0) + live;
          const remaining = unbilledDays(tracked, billed[project]);
          const total = sumDays(remaining);
          grand += total;
          if (scopeAll) {
            if (total > 0) lines.push(`${fmt(total).padStart(8)}  ${project}`);
          } else {
            for (const [d, s] of Object.entries(remaining).sort(([a], [b]) => b.localeCompare(a))) {
              lines.push(`  ${d}  ${fmt(s)}`);
            }
          }
        }
        const header = scopeAll ? "Unbilled time by project:" : `Unbilled time for ${ctx.cwd}:`;
        ctx.ui.notify(
          grand > 0
            ? `${header}\n${lines.join("\n")}\n  Total: ${fmt(grand)} (${(grand / 3600).toFixed(2)}h)`
            : "Nothing unbilled. You're square.",
          "info",
        );
        return;
      }

      if (arg === "clients") {
        const invoices = loadInvoices();
        const billed = billedMap(invoices);
        const rollups = rollupByClient(
          store,
          loadClients(),
          billed,
          live > 0 ? { project: ctx.cwd, seconds: live } : undefined,
        );
        if (rollups.length === 0) {
          ctx.ui.notify("No time tracked yet.", "info");
          return;
        }
        const lines = rollups.map((r) => {
          const un = r.unbilledSeconds > 0.5 ? `  (${(r.unbilledSeconds / 3600).toFixed(2)}h unbilled)` : "";
          return `${fmt(r.totalSeconds).padStart(8)}  ${r.client} [${r.projects.length}]${un}`;
        });
        const grandUn = rollups.reduce((a, r) => a + r.unbilledSeconds, 0);
        ctx.ui.notify(
          `Time by client:\n${lines.join("\n")}\n  Unbilled total: ${(grandUn / 3600).toFixed(2)}h`,
          "info",
        );
        return;
      }

      if (arg === "invoices") {
        const invoices = loadInvoices();
        const lines = invoices.map(
          (i) =>
            `${i.id}  ${i.createdAt.slice(0, 10)}  ${i.totalHours.toFixed(2)}h  ${Object.keys(i.projects).length} project(s)${i.label ? `  "${i.label}"` : ""}`,
        );
        ctx.ui.notify(lines.length ? `Invoices:\n${lines.join("\n")}` : "No invoices yet.", "info");
        return;
      }

      if (arg.startsWith("invoice")) {
        let rest = arg.slice(7).trim();
        const scopeAll = rest === "all" || rest.startsWith("all ");
        if (scopeAll) rest = rest.slice(3).trim();
        const label = rest || undefined;

        // Close out any in-flight time so the invoice captures it.
        accrue(ctx.cwd);
        const freshStore = loadStore();

        const invoices = loadInvoices();
        const billed = billedMap(invoices);
        const projects = scopeAll ? Object.keys(freshStore) : [ctx.cwd];
        const invProjects: Record<string, Record<string, number>> = {};
        let totalSeconds = 0;
        for (const project of projects) {
          const remaining = unbilledDays(freshStore[project] ?? {}, billed[project]);
          const total = sumDays(remaining);
          if (total > 0) {
            invProjects[project] = Object.fromEntries(
              Object.entries(remaining).map(([d, s]) => [d, Math.round(s)]),
            );
            totalSeconds += total;
          }
        }
        if (totalSeconds <= 0) {
          ctx.ui.notify("Nothing unbilled to invoice.", "info");
          return;
        }

        const totalHours = Math.round((totalSeconds / 3600) * 100) / 100;
        const invoice: Invoice = {
          id: nextInvoiceId(invoices),
          ...(label ? { label } : {}),
          createdAt: new Date().toISOString(),
          totalSeconds: Math.round(totalSeconds),
          totalHours,
          projects: invProjects,
        };

        const ok = await ctx.ui.confirm(
          `Create ${invoice.id}?`,
          `${totalHours.toFixed(2)}h across ${Object.keys(invProjects).length} project(s) will be marked as billed.`,
        );
        if (!ok) return;

        invoices.push(invoice);
        saveInvoices(invoices);
        const outPath = join(ctx.cwd, `${invoice.id}.json`);
        writeFileSync(outPath, JSON.stringify(invoice, null, 2));
        ctx.ui.notify(`Created ${invoice.id}: ${totalHours.toFixed(2)}h billed.\nWrote ${outPath}`, "info");
        return;
      }

      if (arg === "reset") {
        const ok = await ctx.ui.confirm(
          "Reset time tracking",
          `Delete all tracked time for ${ctx.cwd}?`,
        );
        if (ok) {
          delete store[ctx.cwd];
          saveStore(store);
          activeStart = undefined;
          lastSettledAt = undefined;
          sessionSeconds = 0;
          ctx.ui.notify("Time tracking reset for this project", "info");
          updateStatus(ctx);
        }
        return;
      }

      if (arg === "all") {
        const clients = loadClients();
        const lines = Object.entries(store).map(([project, days]) => {
          const total =
            Object.values(days).reduce((a, b) => a + b, 0) + (project === ctx.cwd ? live : 0);
          const tag = clients[project] ? `  [${clients[project]}]` : "";
          return `${fmt(total).padStart(8)}  ${project}${tag}`;
        });
        if (!store[ctx.cwd] && live > 0) {
          lines.push(`${fmt(live).padStart(8)}  ${ctx.cwd} (in progress)`);
        }
        ctx.ui.notify(
          lines.length ? `Tracked time by project:\n${lines.join("\n")}` : "No time tracked yet.",
          "info",
        );
        return;
      }

      const days = store[ctx.cwd] ?? {};
      const today = (days[dateKey()] ?? 0) + live;

      if (arg === "days") {
        const lines = Object.entries(days)
          .sort(([a], [b]) => b.localeCompare(a))
          .map(([d, s]) => `${d}  ${fmt(d === dateKey() ? s + live : s)}`);
        ctx.ui.notify(
          lines.length ? `Daily breakdown (${ctx.cwd}):\n${lines.join("\n")}` : "No time tracked yet for this project.",
          "info",
        );
        return;
      }

      const ws = weekStart();
      const week =
        Object.entries(days)
          .filter(([d]) => d >= ws)
          .reduce((a, [, s]) => a + s, 0) + live;
      const total = Object.values(days).reduce((a, b) => a + b, 0) + live;

      const client = loadClients()[ctx.cwd];
      ctx.ui.notify(
        [
          `Active time for ${ctx.cwd}:`,
          ...(client ? [`  Client:     ${client}`] : []),
          `  Today:      ${fmt(today)}`,
          `  This week:  ${fmt(week)}`,
          `  All time:   ${fmt(total)}`,
          `  This pi session: ${fmt(sessionSeconds + live)}`,
        ].join("\n"),
        "info",
      );
    },
  });
}
