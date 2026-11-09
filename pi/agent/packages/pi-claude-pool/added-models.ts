const ADDED = [{ id: "claude-fable-5-2", name: "Claude Fable 5.2", from: "claude-fable-5-1" }];
const BARE_ID_CONTEXT = 200_000;

export function withAddedModels<T extends { id: string; name: string; contextWindow?: number }>(models: T[]): T[] {
  const result = [...models];
  for (const added of ADDED) {
    if (result.some((model) => model.id === added.id)) continue;
    const index = result.findIndex((model) => model.id === added.from);
    if (index === -1) continue;
    result.splice(index, 0, { ...result[index], id: added.id, name: added.name, contextWindow: BARE_ID_CONTEXT });
  }
  return result;
}
