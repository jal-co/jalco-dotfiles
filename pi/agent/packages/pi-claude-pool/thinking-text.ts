import type { AssistantMessage, Message } from "@earendil-works/pi-ai";

const MAX_REMEMBERED = 4000;

export function createThinkingText() {
  const original = new Map<string, string>();

  function remember(message: AssistantMessage): void {
    for (const block of message.content) {
      if (block.type !== "thinking" || !block.thinkingSignature) continue;
      original.delete(block.thinkingSignature);
      original.set(block.thinkingSignature, block.thinking);
      if (original.size > MAX_REMEMBERED) original.delete(original.keys().next().value ?? "");
    }
  }

  function restore(messages: Message[]) {
    let restored = 0;
    const next = messages.map((message) => {
      if (message.role !== "assistant") return message;
      let changed = false;
      const content = message.content.map((block) => {
        if (block.type !== "thinking" || !block.thinkingSignature) return block;
        const text = original.get(block.thinkingSignature);
        if (text === undefined || text === block.thinking) return block;
        changed = true;
        restored++;
        return { ...block, thinking: text };
      });
      return changed ? { ...message, content } : message;
    });
    return { messages: restored ? next : messages, restored };
  }

  return { remember, restore };
}
