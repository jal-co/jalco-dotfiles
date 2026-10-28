import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const supportDirectory = join(homedir(), "Library", "Application Support", "Rex Markdown");
export const ticketDirectory = join(supportDirectory, "tickets");

export function resolveMarkdownPath(href, cwd) {
  let path;
  try {
    if (href.startsWith("file:")) {
      const url = new URL(href);
      if (url.hostname && url.hostname !== "localhost") return;
      url.hash = "";
      url.search = "";
      path = fileURLToPath(url);
    } else {
      if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(href)) return;
      path = decodeURIComponent(href.split(/[?#]/, 1)[0]).replace(/\\([\\()[\] ])/g, "$1");
      path = path.startsWith("~/") ? join(homedir(), path.slice(2)) : resolve(cwd, path);
    }
  } catch {
    return;
  }
  if (!/\.(md|markdown)$/i.test(extname(path))) return;
  const candidates = isAbsolute(href) ? [path, resolve(cwd, `.${path}`)] : [path];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    }
  }
}

export function rewriteMarkdown(source, tokens, linkFor) {
  let cursor = 0;
  let result = "";
  for (const token of tokens) {
    if (!token.raw) continue;
    const start = source.indexOf(token.raw, cursor);
    if (start < 0) continue;
    let replacement = token.raw;
    if (token.type === "link") {
      const target = linkFor(token.href);
      if (target) {
        const title = token.title ? ` "${token.title.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : "";
        replacement = `[${token.text}](${target}${title})`;
      }
    } else if (token.type === "blockquote" || token.type === "list_item") {
      const rawLines = token.raw.split("\n");
      const textLines = token.text.split("\n");
      if (textLines.length <= rawLines.length && textLines.every((line, index) => rawLines[index].endsWith(line))) {
        const rewritten = rewriteMarkdown(token.text, token.tokens, linkFor).split("\n");
        if (rewritten.length === textLines.length) {
          replacement = rawLines.map((line, index) => index < textLines.length
            ? line.slice(0, line.length - textLines[index].length) + rewritten[index]
            : line).join("\n");
        }
      }
    } else if (!["code", "codespan", "html", "image"].includes(token.type)) {
      const children = token.tokens ?? token.items ?? (token.type === "table" ? [...token.header, ...token.rows.flat()].flatMap((cell) => cell.tokens) : []);
      replacement = rewriteMarkdown(token.raw, children, linkFor);
    }
    result += source.slice(cursor, start) + replacement;
    cursor = start + token.raw.length;
  }
  return result + source.slice(cursor);
}

export function createTickets(context, directory = ticketDirectory) {
  const files = new Map();
  return {
    link(path) {
      if (files.has(path)) return files.get(path).url;
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const token = randomBytes(32).toString("hex");
      const file = join(directory, `${token}.json`);
      writeFileSync(file, JSON.stringify({ ...context, path }), { flag: "wx", mode: 0o600 });
      const url = `rex-md://open/${token}`;
      files.set(path, { file, url });
      return url;
    },
    close() {
      for (const { file } of files.values()) {
        try {
          unlinkSync(file);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      files.clear();
    },
  };
}

export function readTicket(url, directory = ticketDirectory) {
  const match = /^rex-md:\/\/open\/([a-f0-9]{64})$/.exec(url);
  if (!match) throw new Error("Invalid Rex Markdown link");
  const ticket = JSON.parse(readFileSync(join(directory, `${match[1]}.json`), "utf8"));
  if (!/^session:[a-f0-9-]+$/.test(ticket.session) || !/^block:[a-f0-9-]+$/.test(ticket.block)) {
    throw new Error("Invalid Rex destination");
  }
  if (!ticket.server?.startsWith("unix:///") || !isAbsolute(ticket.path) || !/\.(md|markdown)$/i.test(ticket.path) || !statSync(ticket.path).isFile()) {
    throw new Error("The Markdown link no longer points to a local file");
  }
  return ticket;
}

export function browserEnvironment() {
  const root = join(homedir(), ".local", "state", "rex-markdown-browser");
  return {
    HOME: join(root, "home"),
    TERMINAL_BROWSER_NO_TELEMETRY: "1",
    TERMINAL_BROWSER_PRESENT: "animation",
    TERMINAL_BROWSER_APPDATA: join(root, "profiles"),
    TERMINAL_BROWSER_CONFIG_DIR: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_STATE_HOME: join(root, "state"),
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_RUNTIME_DIR: join(root, "run"),
  };
}

export function browserArguments(ticket, browser) {
  const environment = Object.entries(browserEnvironment()).map(([key, value]) => `${key}=${value}`);
  const previewUrl = `terminal-browser-file://file${pathToFileURL(ticket.path).pathname}`;
  return ["--server", ticket.server, "run", "--session", ticket.session, "--block", ticket.block, "--split", "right", "--ratio", "45", "--focus=false", "--shell=none", "--cwd", dirname(ticket.path), "--json", "--label", "Markdown", "--", "/usr/bin/env", ...environment, browser, "open", "--no-merge", previewUrl];
}
