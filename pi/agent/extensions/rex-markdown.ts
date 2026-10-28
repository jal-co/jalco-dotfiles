import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.resolve("@earendil-works/pi-tui"));
const { lexer } = require("marked");

export default async function rexMarkdown(pi: ExtensionAPI) {
  const source = pathToFileURL(realpathSync(fileURLToPath(import.meta.url)));
  const { createTickets, resolveMarkdownPath, rewriteMarkdown } = await import(new URL("../../../tools/rex-markdown/bridge.mjs", source).href);
  let tickets: ReturnType<typeof createTickets> | undefined;
  let cwd: string;

  pi.registerMarkdownTransformer((markdown, context) => {
    const activeTickets = tickets;
    if (!activeTickets || context.messageType === "assistant-thinking") return markdown;
    return rewriteMarkdown(markdown, lexer(markdown), (href: string) => {
      const path = resolveMarkdownPath(href, cwd);
      return path ? activeTickets.link(path) : undefined;
    });
  });

  pi.on("session_start", async (_event, ctx) => {
    tickets?.close();
    tickets = undefined;
    if (ctx.mode !== "tui" || process.platform !== "darwin" || !process.env.REX_SESSION || !process.env.REX_BLOCK) return;
    if (!existsSync(join(homedir(), "Applications", "Rex Markdown.app", "Contents", "MacOS", "RexMarkdown"))) {
      ctx.ui.notify("Rex Markdown needs its URL handler installed from ~/dotfiles/tools/rex-markdown/install.mjs", "warning");
      return;
    }
    const result = await pi.exec("rex", ["whoami", "--json"]);
    if (result.code !== 0) {
      ctx.ui.notify(`Rex Markdown could not connect to Rex: ${result.stderr}`, "error");
      return;
    }
    const rex = JSON.parse(result.stdout);
    if (!rex.endpoint?.startsWith("unix:///") || rex.session_id !== process.env.REX_SESSION || rex.block_id !== process.env.REX_BLOCK) {
      ctx.ui.notify("Rex Markdown requires a local Rex terminal", "warning");
      return;
    }
    cwd = ctx.cwd;
    tickets = createTickets({ session: rex.session_id, block: rex.block_id, server: rex.endpoint });
  });

  pi.on("session_shutdown", () => {
    tickets?.close();
    tickets = undefined;
  });
}
