const ADDED = [{ id: "claude-fable-5-2", name: "Claude Fable 5.2 1M", from: "claude-fable-5-1", contextWindow: 1_000_000 }];
const LONG_CONTEXT_SUFFIX = "[1m]";

type Identified = { id: string };
type Message = { model?: string };
type StreamEvent = { partial?: Message; message?: Message; error?: Message };

export function withAddedModels<T extends { id: string; name: string; contextWindow?: number }>(models: T[]): T[] {
  const result = [...models];
  for (const added of ADDED) {
    if (result.some((model) => model.id === added.id)) continue;
    const index = result.findIndex((model) => model.id === added.from);
    if (index === -1) continue;
    result.splice(index, 0, { ...result[index], id: added.id, name: added.name, contextWindow: added.contextWindow });
  }
  return result;
}

export function withLongContextIds<M extends Identified, C, O, E extends StreamEvent>(
  source: (model: M, context: C, options?: O) => AsyncIterable<E>,
  bridgeModels: Identified[],
): (model: M, context: C, options?: O) => AsyncIterable<E> {
  const native = new Set(bridgeModels.map((model) => model.id));
  return (model, context, options) => {
    if (native.has(model.id) || !ADDED.some((added) => added.id === model.id)) return source(model, context, options);
    const bridgeId = model.id + LONG_CONTEXT_SUFFIX;
    const stream = source({ ...model, id: bridgeId }, context, options);
    return (async function* () {
      for await (const event of stream) {
        for (const message of [event.partial, event.message, event.error]) {
          if (message?.model === bridgeId) message.model = model.id;
        }
        yield event;
      }
    })();
  };
}
