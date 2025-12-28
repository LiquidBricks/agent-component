import { Codes } from './codes.js';
import { create as createSubject } from '@liquid-bricks/lib-nats-subject/create/basic';

const DEFAULT_BACKOFF = {
  initialDelayMs: 1_000,
  maxDelayMs: 30_000,
  factor: 2,
};

const DEFAULT_QUEUE_LIMIT = 20;

/**
 * Validate inputs and derive the stable values the component agent needs.
 */
export function createAgentConfig({
  ipAddress,
  port,
  protocols,
  wsOptions,
  directories,
  diagnostics: diagnosticsInput,
} = {}) {
  const diagnostics = diagnosticsInput?.child
    ? diagnosticsInput.child({ agentName: 'componentAgent' })
    : diagnosticsInput;

  if (!diagnostics) {
    throw new Error('diagnostics is required to start the component agent');
  }

  diagnostics.require(
    ipAddress,
    Codes.PRECONDITION_REQUIRED,
    'ipAddress is required to start the component agent',
    { field: 'ipAddress' },
  );
  diagnostics.require(
    port,
    Codes.PRECONDITION_REQUIRED,
    'port is required to start the component agent',
    { field: 'port' },
  );
  diagnostics.require(
    directories,
    Codes.PRECONDITION_REQUIRED,
    'directories is required',
    { field: 'directories' },
  );
  diagnostics.require(
    Array.isArray(directories),
    Codes.PRECONDITION_INVALID,
    'directories must be an array',
    { field: 'directories' },
  );

  const endpoint = `ws://${ipAddress}:${port}/componentAgent`;
  const registerComponentsSubject = createSubject()
    .env('prod')
    .ns('component-service')
    .context('component-agent')
    .channel('cmd')
    .entity('agent')
    .action('register-components')
    .version('v1')
    .build();

  return {
    diagnostics,
    ipAddress,
    port,
    protocols,
    wsOptions,
    directories,
    endpoint,
    registerComponentsSubject,
    backoff: { ...DEFAULT_BACKOFF },
    concurrentQueueLimit: DEFAULT_QUEUE_LIMIT,
  };
}
