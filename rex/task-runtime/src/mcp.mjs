import { Manager } from './manager.mjs';
import { callTool, toolDefinitions } from './tools.mjs';

export function createProtocol(manager) {
  let initialized = false;
  return (request) => {
    const id = typeof request?.id === 'string' || typeof request?.id === 'number' ? request.id : null;
    const error = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
    if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string' || Array.isArray(request) || (request.id !== undefined && request.id !== null && typeof request.id !== 'string' && typeof request.id !== 'number')) return error(-32600, 'Invalid request');
    if (request.id === undefined) return undefined;
    let result;
    if (request.method === 'initialize') {
      const version = request.params?.protocolVersion;
      if (typeof version !== 'string') return error(-32602, 'protocolVersion is required');
      initialized = true;
      result = { protocolVersion: ['2024-11-05', '2025-03-26', '2025-06-18'].includes(version) ? version : '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'rex-plugins', version: '0.1.0' }, instructions: 'Local process control only. Launch requires user authorization. These tools are not a sandbox. Stop requests require exit verification. No automatic task-result notification is provided.' };
    } else if (request.method === 'ping') result = {};
    else if (!initialized) return error(-32000, 'Initialize first');
    else if (request.method === 'tools/list') result = { tools: toolDefinitions };
    else if (request.method === 'tools/call') {
      if (typeof request.params?.name !== 'string') return error(-32602, 'Tool name is required');
      try {
        const value = callTool(manager, request.params.name, request.params.arguments);
        result = { content: [{ type: 'text', text: JSON.stringify(value) }] };
      } catch (failure) { result = { isError: true, content: [{ type: 'text', text: failure.message }] }; }
    } else return error(-32601, 'Method not found');
    return { jsonrpc: '2.0', id, result };
  };
}

export function serve(manager, input = process.stdin, output = process.stdout) {
  const handle = createProtocol(manager);
  const limit = 256 * 1024;
  let buffer = '';
  input.setEncoding('utf8');
  input.on('data', (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (Buffer.byteLength(line) > limit) { output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Message too large' } }) + '\n'); continue; }
      if (!line.trim()) continue;
      let response;
      try { response = handle(JSON.parse(line)); } catch { response = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }; }
      if (response) output.write(JSON.stringify(response) + '\n');
    }
    if (Buffer.byteLength(buffer) > limit) { input.destroy(new Error('MCP input limit exceeded')); }
  });
  input.on('error', (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}

if (import.meta.main) serve(new Manager());
