// Managed by CMBridge
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";

type AgentState = "idle" | "thinking" | "complete" | "needs-input" | "error";

const directory = join(homedir(), ".codex-micro", "agents");

function textOf(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: "text"; text: string } =>
      Boolean(part) && typeof part === "object"
        && (part as { type?: unknown }).type === "text"
        && typeof (part as { text?: unknown }).text === "string")
    .map((part) => part.text)
    .join("\n");
}

function terminalBundleId(): string | undefined {
  if (process.env.ZENTTY_PANE_ID) return "be.zenjoy.zentty";
  if (process.env.GHOSTTY_BIN_DIR?.startsWith("/Applications/Zentty.app/")) return "be.zenjoy.zentty";
  const terminal = process.env.TERM_PROGRAM;
  if (terminal === "Apple_Terminal") return "com.apple.Terminal";
  if (terminal === "iTerm.app") return "com.googlecode.iterm2";
  if (terminal === "WezTerm") return "com.github.wez.wezterm";
  if (terminal === "ghostty") return "com.mitchellh.ghostty";
  return undefined;
}

function zenttyActivation() {
  const paneId = process.env.ZENTTY_PANE_ID;
  const paneToken = process.env.ZENTTY_PANE_TOKEN;
  const instanceSocket = process.env.ZENTTY_INSTANCE_SOCKET;
  if (!paneId || !paneToken || !instanceSocket) return undefined;
  return {
    kind: "zentty-pane",
    paneId,
    paneToken,
    instanceSocket,
    windowId: process.env.ZENTTY_WINDOW_ID,
    worklaneId: process.env.ZENTTY_WORKLANE_ID,
  };
}

function herdrActivation() {
  const paneId = process.env.HERDR_PANE_ID;
  const socketPath = process.env.HERDR_SOCKET_PATH;
  if (process.env.HERDR_ENV !== "1" || !paneId || !socketPath) return undefined;
  return { kind: "herdr-pane", paneId, socketPath };
}

export default function codexMicroReporter(pi: ExtensionAPI) {
  let activeFile: string | undefined;
  let state: AgentState = "idle";
  let errored = false;
  let lastAssistantText = "";
  let writes = Promise.resolve();

  const enqueue = (operation: () => Promise<void>): Promise<void> => {
    writes = writes.then(operation, operation);
    return writes;
  };

  const writeState = (ctx: ExtensionContext, next: AgentState): Promise<void> => {
    state = next;
    return enqueue(async () => {
      if (!activeFile) return;
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
      const value = {
        agent: "pi",
        project: basename(ctx.cwd),
        state,
        terminal: terminalBundleId(),
        pid: process.pid,
        activation: herdrActivation() ?? zenttyActivation(),
      };
      const temporary = `${activeFile}.tmp-${process.pid}`;
      await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, activeFile);
      await chmod(activeFile, 0o600);
    });
  };

  const removeState = (): Promise<void> => enqueue(async () => {
    if (!activeFile) return;
    await rm(activeFile, { force: true });
    activeFile = undefined;
  });

  const cleanupSync = () => {
    if (!activeFile) return;
    try { unlinkSync(activeFile); } catch {}
  };
  process.once("exit", cleanupSync);

  pi.on("session_start", async (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId()
      .replace(/[^a-zA-Z0-9._-]/g, "-");
    activeFile = join(directory, `${sessionId}.json`);
    errored = false;
    lastAssistantText = "";
    await writeState(ctx, "idle");
  });

  pi.on("agent_start", async (_event, ctx) => {
    errored = false;
    lastAssistantText = "";
    await writeState(ctx, "thinking");
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    if (!event.isError) return;
    errored = true;
    await writeState(ctx, "error");
  });

  pi.on("message_end", (event) => {
    if (event.message.role === "assistant") lastAssistantText = textOf(event.message);
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (errored) await writeState(ctx, "error");
    else if (/\?\s*$/.test(lastAssistantText)) await writeState(ctx, "needs-input");
    else await writeState(ctx, "complete");
  });

  pi.on("input", async (_event, ctx) => {
    if (state === "complete" || state === "needs-input" || state === "error") {
      await writeState(ctx, "idle");
    }
    return { action: "continue" };
  });

  pi.on("session_shutdown", async () => {
    await removeState();
    process.off("exit", cleanupSync);
  });
}
