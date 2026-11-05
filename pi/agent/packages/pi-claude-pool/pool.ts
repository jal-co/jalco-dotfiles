import { createHash } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { Account } from "./config.ts";

export type BlockReason = "quota" | "auth";

const AccountRow = Type.Object({
  id: Type.String(),
  blocked_until: Type.Integer(),
  reason: Type.Union([Type.Null(), Type.Literal("quota"), Type.Literal("auth")]),
});

export class PoolUnavailableError extends Error {}

export class AccountPool {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  private transaction<T>(run: (db: DatabaseSync) => T): T {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(this.path);
    try {
      chmodSync(this.path, 0o600);
      db.exec(`
        PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, assigned INTEGER NOT NULL DEFAULT 0,
          blocked_until INTEGER NOT NULL DEFAULT 0, reason TEXT
        );
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY, account TEXT NOT NULL, seen INTEGER NOT NULL
        );
        BEGIN IMMEDIATE;
      `);
      try {
        const result = run(db);
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    } finally {
      db.close();
    }
  }

  select(accounts: Account[], sessionId: string, excluded: Set<string>, now = Date.now()): Account {
    return this.transaction((db) => {
      const upsert = db.prepare(`
        INSERT INTO accounts (id, fingerprint) VALUES (?, ?)
        ON CONFLICT(id) DO UPDATE SET
          blocked_until = CASE WHEN fingerprint = excluded.fingerprint THEN blocked_until ELSE 0 END,
          reason = CASE WHEN fingerprint = excluded.fingerprint THEN reason ELSE NULL END,
          fingerprint = excluded.fingerprint
      `);
      for (const account of accounts) upsert.run(account.id, fingerprint(account));
      const rows = db.prepare("SELECT id, blocked_until, reason FROM accounts ORDER BY assigned, id").all().map((row) => {
        if (!Value.Check(AccountRow, row)) throw new Error("Invalid Claude pool state");
        return row;
      });
      const eligible = rows.filter((row) => accounts.some((account) => account.id === row.id) && row.blocked_until <= now && !excluded.has(row.id));
      const previous = db.prepare("SELECT account FROM sessions WHERE id = ?").get(sessionId)?.account;
      const selected = eligible.find((row) => row.id === previous) ?? eligible[0];
      if (!selected) {
        const status = rows.filter((row) => accounts.some((account) => account.id === row.id)).map((row) =>
          row.reason === "auth" ? `${row.id}: replace expired or rejected token` : row.blocked_until > now
            ? `${row.id}: quota resets ${new Date(row.blocked_until).toISOString()}` : `${row.id}: already attempted`,
        );
        throw new PoolUnavailableError(`Claude subscriptions unavailable. ${status.join("; ")}.`);
      }
      if (selected.id !== previous) db.prepare("UPDATE accounts SET assigned = (SELECT COALESCE(MAX(assigned), 0) + 1 FROM accounts) WHERE id = ?").run(selected.id);
      db.prepare("INSERT INTO sessions (id, account, seen) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET account = excluded.account, seen = excluded.seen").run(sessionId, selected.id, now);
      db.prepare("DELETE FROM sessions WHERE seen < ?").run(now - 30 * 24 * 60 * 60 * 1000);
      const account = accounts.find((candidate) => candidate.id === selected.id);
      if (!account) throw new PoolUnavailableError("Selected subscription is no longer configured.");
      return account;
    });
  }

  block(account: Account, reason: BlockReason, until: number): void {
    this.transaction((db) => {
      db.prepare("UPDATE accounts SET reason = CASE WHEN ? >= blocked_until THEN ? ELSE reason END, blocked_until = MAX(blocked_until, ?) WHERE id = ? AND fingerprint = ?").run(until, reason, until, account.id, fingerprint(account));
    });
  }
}

function fingerprint(account: Account): string {
  return createHash("sha256").update(account.token).digest("hex");
}
