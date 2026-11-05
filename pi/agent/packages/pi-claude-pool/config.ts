import { execFile } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { promisify } from "node:util";
import { isAbsolute } from "node:path";

export interface Account {
  id: string;
  token: string;
}

export interface AccountSource {
  id: string;
  tokenEnv?: string;
  tokenFile?: string;
  tokenRef?: string;
}

export class PoolConfigError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function readSources(path: string): AccountSource[] {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new PoolConfigError("Create a valid claude-pool.json in the Pi agent directory. See pi-claude-pool/README.md.");
  }
  if (!isRecord(value) || Object.keys(value).some((key) => key !== "accounts") || !Array.isArray(value.accounts) || !value.accounts.length) {
    throw new PoolConfigError("claude-pool.json must contain a nonempty accounts array, with token references rather than tokens.");
  }
  const ids = new Set<string>();
  return value.accounts.map((entry) => {
    if (!isRecord(entry) || Object.keys(entry).some((key) => !["id", "tokenEnv", "tokenFile", "tokenRef"].includes(key)) ||
      typeof entry.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(entry.id) || ids.has(entry.id)) {
      throw new PoolConfigError("Each pool account needs a unique lowercase id and exactly one tokenRef, tokenEnv or tokenFile reference.");
    }
    ids.add(entry.id);
    if ([entry.tokenEnv, entry.tokenFile, entry.tokenRef].filter((value) => value !== undefined).length !== 1) {
      throw new PoolConfigError(`Account ${entry.id} needs exactly one token reference.`);
    }
    if (typeof entry.tokenRef === "string" && /^op:\/\/[^/\r\n]+\/[^/\r\n]+\/(?:[^/\r\n]+\/)?[^/\r\n]+$/.test(entry.tokenRef)) {
      return { id: entry.id, tokenRef: entry.tokenRef };
    }
    if (typeof entry.tokenEnv === "string" && /^CLAUDE_POOL_[A-Z0-9_]+$/.test(entry.tokenEnv)) {
      return { id: entry.id, tokenEnv: entry.tokenEnv };
    }
    if (typeof entry.tokenFile === "string" && isAbsolute(entry.tokenFile)) {
      return { id: entry.id, tokenFile: entry.tokenFile };
    }
    throw new PoolConfigError(`Account ${entry.id} needs an op:// reference, a CLAUDE_POOL_* environment variable or an absolute tokenFile path.`);
  });
}

export async function resolveAccounts(sources: AccountSource[], env: NodeJS.ProcessEnv = process.env, readSecret = readOpSecret): Promise<Account[]> {
  const tokens = new Set<string>();
  return Promise.all(sources.map(async (source) => {
    let token: string | undefined;
    if (source.tokenRef) {
      try { token = await readSecret(source.tokenRef); }
      catch { throw new PoolConfigError(`Cannot read the 1Password token for ${source.id}. Check op and its noninteractive vault access.`); }
    } else if (source.tokenEnv) token = env[source.tokenEnv];
    else if (source.tokenFile) {
      try {
        const stat = statSync(source.tokenFile);
        if (!stat.isFile() || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) {
          throw new Error("private file required");
        }
        token = readFileSync(source.tokenFile, "utf8");
      } catch {
        throw new PoolConfigError(`Cannot read a private token file for ${source.id}. Use an owner-only file (mode 600).`);
      }
    }
    token = token?.trim();
    if (!token || /\s/.test(token)) throw new PoolConfigError(`Missing or invalid subscription token for ${source.id}.`);
    if (tokens.has(token)) throw new PoolConfigError("Two accounts reference the same token. Supply a different subscription token for each account.");
    tokens.add(token);
    return { id: source.id, token };
  }));
}

const run = promisify(execFile);

async function readOpSecret(reference: string): Promise<string> {
  const { stdout } = await run("op", ["read", "--no-newline", reference], {
    encoding: "utf8", timeout: 10_000, maxBuffer: 16_384,
    env: { ...process.env, AI_AGENT: "pi", PI_CODING_AGENT: "true", OP_BIOMETRIC_UNLOCK_ENABLED: "false" },
  });
  return stdout;
}

export function createOpReader(read = readOpSecret) {
  const cache = new Map<string, Promise<string>>();
  return (reference: string): Promise<string> => {
    const existing = cache.get(reference);
    if (existing) return existing;
    const pending = read(reference).catch((error) => {
      cache.delete(reference);
      throw error;
    });
    cache.set(reference, pending);
    return pending;
  };
}

const AUTH_ENV = [
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_BASE_URL",
  "OP_SERVICE_ACCOUNT_TOKEN", "OP_CONNECT_TOKEN",
  "ANTHROPIC_CUSTOM_HEADERS", "CLAUDE_CODE_API_KEY_HELPER_TTL_MS", "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
  "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY",
];

export function accountEnv(account: Account, overrides: Record<string, string> = {}, parent: NodeJS.ProcessEnv = process.env) {
  const env = { ...overrides };
  for (const name of [...AUTH_ENV, ...Object.keys(parent), ...Object.keys(overrides)]) {
    if (AUTH_ENV.includes(name) || name.startsWith("CLAUDE_POOL_")) env[name] = "";
  }
  env.CLAUDE_CODE_OAUTH_TOKEN = account.token;
  return env;
}
