import { Codes } from './codes.js';

/**
 * Keep WebSocket event handlers focused and testable by isolating them from
 * connection setup details.
 */
export function createSocketHandlers({
  diagnostics,
  endpoint,
  directories,
  queueState,
  reconnect,
}) {
  const handleOpen = () => {
    diagnostics.info('Component agent connected', { endpoint });
    reconnect.reset();

    void (async () => {
      await queueState.registerComponents(directories);
      await queueState.processQueue();
    })().catch((error) => {
      diagnostics.warn(
        false,
        Codes.AGENT_REGISTRATION_FAILED,
        'Component agent registration error',
        { error },
      );
    });
  };

  const handleMessage = async (raw) => {
    const normalizedRaw = typeof raw === 'string' ? raw : raw?.toString?.() ?? '';
    let parsed;

    try {
      parsed = JSON.parse(normalizedRaw);
    } catch (error) {
      diagnostics.warn(false, Codes.PRECONDITION_INVALID,
        'componentDispatcher received invalid JSON', {
        raw: normalizedRaw,
        error: error?.message ?? String(error),
      });
      return;
    }

    await queueState.enqueueMessage(parsed);
  };

  const handleClose = (code, reason) => {
    const normalizedReason = typeof reason === 'string' ? reason : reason?.toString();
    diagnostics.info('Component agent closed', { code, reason: normalizedReason });
    reconnect.schedule();
  };

  const handleError = (error) => {
    diagnostics.warn(false, Codes.AGENT_SOCKET_ERROR, 'Component agent error', { error });
    reconnect.schedule();
  };

  return {
    handleOpen,
    handleMessage,
    handleClose,
    handleError,
  };
}
