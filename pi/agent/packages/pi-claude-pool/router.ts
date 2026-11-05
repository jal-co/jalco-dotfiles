import { randomUUID } from "node:crypto";
import type { Api, AssistantMessage, AssistantMessageEvent, Model, ProviderResponse, SimpleStreamOptions, TranscriptContext } from "@earendil-works/pi-ai";
import { accountEnv, PoolConfigError, type Account } from "./config.ts";
import { AccountPool, PoolUnavailableError, type BlockReason } from "./pool.ts";

export type BridgeStream = (model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions) => AsyncIterable<AssistantMessageEvent>;

type Failure = { reason: BlockReason; until: number };

export function accountFailure(message: string, response?: ProviderResponse, now = Date.now()): Failure | undefined {
  if (response?.status === 401 || /^(?:API Error:\s*401|HTTP\s+401|authentication_error\b|Invalid API key\b|OAuth token (?:has )?expired\b)/i.test(message)) {
    return { reason: "auth", until: Number.MAX_SAFE_INTEGER };
  }
  const headers = response?.headers ?? {};
  if (response?.status === 429 || headers["anthropic-ratelimit-unified-status"] === "rejected" || /^(?:Claude quota exceeded\b|API Error:\s*429\b|HTTP\s+429\b|You're out of extra usage\b|You've hit your limit\b)/i.test(message)) {
    const reset = Number(headers["anthropic-ratelimit-unified-reset"]) * 1000;
    const retryAfter = Number(headers["retry-after"]) * 1000;
    const until = Number.isSafeInteger(reset) && reset > now && reset <= 8.64e15 ? reset
      : Number.isSafeInteger(retryAfter) && retryAfter > 0 && now + retryAfter <= 8.64e15 ? now + retryAfter : now + 60_000;
    return { reason: "quota", until };
  }
}

function errorEvent(model: Model<Api>, message: string, aborted: boolean, partial?: AssistantMessage): AssistantMessageEvent {
  const error: AssistantMessage = {
    role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [], timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    ...partial,
    stopReason: aborted ? "aborted" : "error",
    errorMessage: message,
  };
  return { type: "error", reason: aborted ? "aborted" : "error", error };
}

function redact(message: string, accounts: Account[]): string {
  for (const account of accounts) message = message.replaceAll(account.token, "[redacted]");
  return message.replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]");
}

export class SubscriptionRouter {
  private readonly pinned = new Map<string, Account>();
  private readonly busy = new Set<string>();
  private readonly pool: AccountPool;
  private readonly accounts: () => Account[] | Promise<Account[]>;

  constructor(pool: AccountPool, accounts: () => Account[] | Promise<Account[]>) {
    this.pool = pool;
    this.accounts = accounts;
  }

  release(sessionId: string): void {
    this.pinned.delete(sessionId);
  }

  async *stream(source: BridgeStream, model: Model<Api>, context: TranscriptContext, options: SimpleStreamOptions = {}): AsyncGenerator<AssistantMessageEvent> {
    const sessionId = options.cacheRetention === "none" ? randomUUID() : options.sessionId ?? randomUUID();
    if (this.busy.has(sessionId)) {
      yield errorEvent(model, "Claude pool already has a request running for this session.", false);
      return;
    }
    this.busy.add(sessionId);
    let accounts: Account[] = [];
    let partial: AssistantMessage | undefined;
    let emitted = false;
    let parked = false;
    try {
      if (!options.sessionId && options.cacheRetention !== "none") throw new PoolConfigError("Claude pool requires a Pi session id for tool-safe account affinity.");
      if (process.env.CLAUDE_BRIDGE_TRACE_PROXY) throw new PoolConfigError("Unset CLAUDE_BRIDGE_TRACE_PROXY before using subscription tokens.");
      if (options.signal?.aborted) {
        yield errorEvent(model, "Operation aborted", true);
        return;
      }
      accounts = await this.accounts();
      const attempted = new Set<string>();
      let account = this.pinned.get(sessionId);
      while (attempted.size < accounts.length) {
        if (options.signal?.aborted) {
          yield errorEvent(model, "Operation aborted", true, partial);
          return;
        }
        account ??= this.pool.select(accounts, sessionId, attempted);
        attempted.add(account.id);
        let response: ProviderResponse | undefined;
        let start: Extract<AssistantMessageEvent, { type: "start" }> | undefined;
        let failure: Extract<AssistantMessageEvent, { type: "error" }> | undefined;
        const stream = source(model, context, {
          ...options,
          env: accountEnv(account, options.env),
          onResponse: async (result, responseModel) => {
            response = result;
            await options.onResponse?.(result, responseModel);
          },
        });
        for await (const event of stream) {
          if (failure) throw new Error("Bridge emitted events after its terminal error");
          if (event.type === "start") {
            start = event;
            partial = event.partial;
            continue;
          }
          if (event.type === "error") {
            failure = event;
            partial = event.error;
            continue;
          }
          if (start) {
            yield start;
            start = undefined;
          }
          if (event.type === "done") {
            parked = event.reason === "toolUse" && Boolean(options.sessionId) && options.cacheRetention !== "none";
            if (parked) this.pinned.set(sessionId, account);
            else this.pinned.delete(sessionId);
            yield event;
            return;
          }
          emitted = true;
          partial = event.partial;
          yield event;
        }
        if (!failure) throw new Error("Bridge stream ended without a terminal event");
        this.pinned.delete(sessionId);
        const aborted = failure.reason === "aborted" || Boolean(options.signal?.aborted);
        const classification = aborted ? undefined : accountFailure(failure.error.errorMessage ?? "", response);
        if (classification) this.pool.block(account, classification.reason, classification.until);
        const hasContent = emitted || failure.error.content.some((block) => block.type !== "text");
        if (aborted || hasContent || !classification) {
          const message = aborted ? "Operation aborted" : hasContent
            ? "Claude pool stopped after partial output. No automatic replay was attempted; continue manually."
            : redact(failure.error.errorMessage ?? "Claude bridge request failed.", [...accounts, account]);
          yield errorEvent(model, message, aborted, emitted ? failure.error : undefined);
          return;
        }
        account = undefined;
      }
      this.pool.select(accounts, sessionId, attempted);
      throw new PoolUnavailableError("All configured subscriptions were attempted.");
    } catch (error) {
      this.pinned.delete(sessionId);
      const message = emitted ? "Claude pool stopped after partial output. No automatic replay was attempted; continue manually."
        : error instanceof PoolConfigError || error instanceof PoolUnavailableError ? error.message
        : "Claude pool failed locally. Check the package setup and routing-state file permissions; no account switch was attempted.";
      yield errorEvent(model, message, Boolean(options.signal?.aborted), emitted ? partial : undefined);
    } finally {
      if (!parked) this.pinned.delete(sessionId);
      this.busy.delete(sessionId);
    }
  }
}
