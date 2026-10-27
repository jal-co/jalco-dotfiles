import { Manager } from '../src/manager.mjs';
import { callTool, toolDefinitions } from '../src/tools.mjs';

export default function rexTools(pi) {
  let manager;
  for (const tool of toolDefinitions) {
    pi.registerTool({
      name: tool.name,
      label: tool.name.replaceAll('_', ' '),
      description: tool.description,
      parameters: tool.inputSchema,
      async execute(_id, args) {
        manager ??= new Manager();
        const value = callTool(manager, tool.name, args);
        return { content: [{ type: 'text', text: JSON.stringify(value) }], details: value };
      },
    });
  }
}
