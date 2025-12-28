import WebSocket from 'ws';
import { createQueueProcessor } from './processQueue.js';
import { createAgentConfig } from './agentConfig.js';
import { createReconnectManager } from './reconnectManager.js';
import { createSocketHandlers } from './socketHandlers.js';

/**
 * Create a WebSocket agent that wires up the common lifecycle events.
 * Handlers receive the socket plus event-specific data so callers can react or clean up.
 */
export function createComponentAgent(options = {}) {
  const {
    diagnostics,
    endpoint,
    directories,
    protocols,
    wsOptions,
    registerComponentsSubject,
    backoff,
    concurrentQueueLimit,
  } = createAgentConfig(options);

  let socket;
  // Mutable holders keep socket handlers in sync with the current connection.
  const queueState = {
    enqueueMessage: async () => {},
    processQueue: async () => {},
    registerComponents: async () => {},
  };

  function connect() {
    socket = new WebSocket(endpoint, protocols, wsOptions);
    const qp = createQueueProcessor({
      diagnostics,
      concurrentQueueLimit,
      socket,
    });

    queueState.enqueueMessage = qp.enqueueMessage;
    queueState.processQueue = qp.processQueue;
    queueState.registerComponents = async (dirs) => {
      await queueState.enqueueMessage({
        subject: registerComponentsSubject,
        data: { directories: dirs },
      });
    };

    socket.on('open', handlers.handleOpen);
    socket.on('message', handlers.handleMessage);
    socket.on('close', handlers.handleClose);
    socket.on('error', handlers.handleError);
  }

  const reconnect = createReconnectManager({
    diagnostics,
    backoff,
    connect,
  });

  const handlers = createSocketHandlers({
    diagnostics,
    endpoint,
    directories,
    queueState,
    reconnect,
  });

  connect();

  return socket;
}
