import { createAssistantMessageEventStream, type Provider } from "@earendil-works/pi-ai";
import { getAgentDir, type ExtensionAPI, type ProviderConfig } from "@earendil-works/pi-coding-agent";
import bridge from "pi-claude-bridge/src/index.ts";
import { join } from "node:path";
import { createOpReader, readSources, resolveAccounts } from "./config.ts";
import { AccountPool } from "./pool.ts";
import { SubscriptionRouter } from "./router.ts";

export default function claudePool(pi: ExtensionAPI): void {
  const agentDir = getAgentDir();
  const readSecret = createOpReader();
  const router = new SubscriptionRouter(
    new AccountPool(join(agentDir, "state", "claude-pool.sqlite")),
    () => resolveAccounts(readSources(join(agentDir, "claude-pool.json")), process.env, readSecret),
  );

  function registerProvider(provider: Provider): void;
  function registerProvider(name: string, config: ProviderConfig): void;
  function registerProvider(provider: Provider | string, config?: ProviderConfig): void {
    if (provider !== "claude-bridge" || !config?.streamSimple) {
      throw new Error("Unexpected Claude bridge registration. Review the pinned bridge version before updating.");
    }
    const source = config.streamSimple;
    pi.registerProvider(provider, {
      ...config,
      name: "Claude subscriptions",
      streamSimple(model, context, options) {
        const stream = createAssistantMessageEventStream();
        void (async () => {
          try {
            for await (const event of router.stream(source, model, context, options)) stream.push(event);
          } finally {
            stream.end();
          }
        })();
        return stream;
      },
    });
  }

  bridge({
    ...pi,
    registerProvider,
    registerTool() {
      throw new Error("Disable askClaude.enabled in claude-bridge.json. The pooled provider does not route the legacy AskClaude tool.");
    },
  });
  pi.on("session_shutdown", (_event, ctx) => router.release(ctx.sessionManager.getSessionId()));
}
