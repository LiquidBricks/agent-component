/**
 * Handle reconnection timing so the socket lifecycle code stays lean.
 */
export function createReconnectManager({
  diagnostics,
  backoff,
  connect,
}) {
  let reconnectTimer;
  let reconnectAttempt = 0;

  const computeReconnectDelay = () => {
    const delay = backoff.initialDelayMs * (backoff.factor ** reconnectAttempt);
    return Math.min(delay, backoff.maxDelayMs);
  };

  const reset = () => {
    reconnectAttempt = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const schedule = () => {
    if (reconnectTimer) return;

    const delay = computeReconnectDelay();
    diagnostics.info('Scheduling component agent reconnect', {
      attempt: reconnectAttempt + 1,
      delayMs: delay,
    });

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnectAttempt += 1;
      connect();
    }, delay);
  };

  return { schedule, reset };
}
