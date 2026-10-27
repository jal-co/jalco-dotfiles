import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export default async function rexTask(pi: ExtensionAPI) {
  if (process.env.PI_REX_AGENT === '1' || !process.env.REX_SESSION) return;
  const { default: register } = await import(pathToFileURL(join(homedir(), 'dotfiles/rex/task.ts')).href);
  await register(pi);
}
