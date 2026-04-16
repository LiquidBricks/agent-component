import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createComponentAgent } from '../index.js';
import { diagnostics as createDiagnostics } from '@liquid-bricks/lib-diagnostics';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envComponentDirectories = (process.env.COMPONENT_DIRECTORIES ?? '')
  .split(',')
  .map((dir) => dir.trim())
  .filter(Boolean)
  .map((dir) => (path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir)));

const componentDirectories = envComponentDirectories.length > 0
  ? envComponentDirectories
  : [path.join(__dirname, 'components')];
const envPort = Number.parseInt(process.env.COMPONENT_AGENT_PORT ?? '', 10);
const port = Number.isFinite(envPort) && envPort > 0 ? envPort : 4000;
const ipAddress = process.env.COMPONENT_AGENT_IP ?? '127.0.0.1';

const componentAgentDiagnostics = createDiagnostics({
  context: () => ({ service: 'agent-component-demo', system: 'component-agent' }),
});

createComponentAgent({
  ipAddress,
  port,
  directories: componentDirectories,
  diagnostics: componentAgentDiagnostics,
});

console.log(`Component agent connected to ws://${ipAddress}:${port}/componentAgent`);
console.log(`Component directories: ${componentDirectories.join(', ')}`);
