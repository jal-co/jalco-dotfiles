import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { browserEnvironment, supportDirectory, ticketDirectory } from "./bridge.mjs";

if (process.platform !== "darwin") throw new Error("Rex Markdown requires macOS");

const source = dirname(fileURLToPath(import.meta.url));
const rex = execFileSync("/usr/bin/which", ["rex"], { encoding: "utf8" }).trim();
const browser = execFileSync("/usr/bin/which", ["terminal-browser"], { encoding: "utf8" }).trim();
const bundle = join(homedir(), "Applications", "Rex Markdown.app");
const contents = join(bundle, "Contents");
const binary = join(contents, "MacOS", "RexMarkdown");
const log = join(supportDirectory, "handler.log");
const escape = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

mkdirSync(dirname(binary), { recursive: true });
mkdirSync(ticketDirectory, { recursive: true, mode: 0o700 });
for (const directory of Object.values(browserEnvironment())) {
  if (isAbsolute(directory)) mkdirSync(directory, { recursive: true, mode: 0o700 });
}
execFileSync(browser, ["config", "set", "render.fps", "30"], { env: { ...process.env, ...browserEnvironment() }, stdio: "inherit" });
writeFileSync(join(supportDirectory, "programs.json"), JSON.stringify({ rex, browser }), { mode: 0o600 });
writeFileSync(log, "", { flag: "a", mode: 0o600 });
writeFileSync(join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>RexMarkdown</string>
<key>CFBundleIdentifier</key><string>org.jalco.rex-markdown</string>
<key>CFBundleName</key><string>Rex Markdown</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>
<key>CFBundleURLTypes</key><array><dict>
<key>CFBundleURLName</key><string>org.jalco.rex-markdown</string>
<key>CFBundleURLSchemes</key><array><string>rex-md</string></array>
</dict></array>
<key>RexMarkdownNode</key><string>${escape(process.execPath)}</string>
<key>RexMarkdownScript</key><string>${escape(join(source, "open.mjs"))}</string>
<key>RexMarkdownLog</key><string>${escape(log)}</string>
</dict></plist>
`);
execFileSync("/usr/bin/swiftc", [join(source, "Handler.swift"), "-o", binary], { stdio: "inherit" });
execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", bundle], { stdio: "inherit" });
execFileSync("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", ["-f", bundle], { stdio: "inherit" });
execFileSync("/usr/bin/swift", ["-e", 'import Foundation; import CoreServices; let result = LSSetDefaultHandlerForURLScheme("rex-md" as CFString, "org.jalco.rex-markdown" as CFString); if result != noErr { fatalError("URL registration failed: \\(result)") }'], { stdio: "inherit" });
process.stdout.write(`Installed ${bundle}\nReload Pi with /reload to enable Markdown clicks.\n`);
