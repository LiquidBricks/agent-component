import { AGENT_SOCKET_ERROR } from '@liquid-bricks/lib-diagnostics/codes';
import { createExecutionRouter } from './router/index.js';

export function createQueueProcessor({
  diagnostics,
  socket,
  concurrentQueueLimit = 20,
} = {}) {
  const messageQueue = [];
  let isProcessingQueue = false;


  const publish = (subject, data) => new Promise((resolve, reject) => {
    const payload = JSON.stringify({ subject, data });
    try {
      socket.send(payload, (error) => {
        if (error) reject(error);
        else resolve();
      });
    } catch (error) {
      reject(error);
    }
  });

  const router = createExecutionRouter({
    publish,
    diagnostics,
  });

  const processQueue = async () => {
    if (isProcessingQueue) {
      return;
    }

    isProcessingQueue = true;
    try {
      while (messageQueue.length > 0) {
        const batch = messageQueue.splice(0, concurrentQueueLimit);
        await Promise.all(batch.map(async (payload) => {
          try {
            if (payload.subject) {
              await router.request({ subject: payload.subject, message: payload });
            }
          } catch (error) {
            diagnostics.warn(false, AGENT_SOCKET_ERROR, 'Failed to process queued component message', {
              error,
              subject: payload?.subject,
            });
          }
        }));
      }
    } finally {
      isProcessingQueue = false;
    }
  };

  const enqueueMessage = async (payload) => {
    messageQueue.push(payload);
    await processQueue();
  };

  return { enqueueMessage, processQueue };
}
