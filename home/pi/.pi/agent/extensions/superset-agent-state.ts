import { execFile } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const homeDir = process.env.SUPERSET_HOME_DIR;
const terminalId = process.env.SUPERSET_TERMINAL_ID;

function enabled(): boolean {
  return Boolean(homeDir && terminalId);
}

function notify(eventName: string, sessionId: string | undefined): void {
  if (!enabled()) return;
  const payload = JSON.stringify({
    hook_event_name: eventName,
    ...(sessionId ? { session_id: sessionId } : {}),
  });
  execFile(
    `${homeDir}/hooks/notify.sh`,
    [payload],
    {
      timeout: 5_000,
      env: { ...process.env, SUPERSET_AGENT_ID: process.env.SUPERSET_AGENT_ID ?? "pi" },
    },
    () => {},
  );
}

export default function supersetAgentState(pi: ExtensionAPI) {
  if (!enabled()) return;

  pi.on("session_start", (_event, ctx) => {
    notify("SessionStart", ctx.sessionManager.getSessionId());
  });

  pi.on("agent_start", (_event, ctx) => {
    notify("Start", ctx.sessionManager.getSessionId());
  });

  pi.on("ui_prompt_start", (_event, ctx) => {
    notify("PermissionRequest", ctx.sessionManager.getSessionId());
  });

  pi.on("ui_prompt_end", (_event, ctx) => {
    notify("Start", ctx.sessionManager.getSessionId());
  });

  pi.on("agent_settled", (_event, ctx) => {
    notify("Stop", ctx.sessionManager.getSessionId());
  });
}
