import { router } from '@liquid-bricks/lib-nats-subject';
import { PRECONDITION_INVALID } from '@liquid-bricks/lib-diagnostics/codes'
import { path as computeFunctionPath, spec as computeFunctionSpec } from './routes/compute_function/index.js'
import { path as registerComponentsPath, spec as registerComponentsSpec } from './routes/register_components/index.js'

export const routes = [
  [registerComponentsPath, registerComponentsSpec],
  [computeFunctionPath, computeFunctionSpec],
]

export function createExecutionRouter({
  diagnostics,
  publish,
}) {
  return router({
    tokens: ['env', 'ns', 'tenant', 'context', 'channel', 'entity', 'action', 'version', 'id'],
    context: {
      publish,
      diagnostics,
      componentStore: createStore(),
      agentFnStore: createStore(),
    },
  })
    .route({}, { children: routes })
    .default({
      handler: ({ message, rootCtx: { diagnostics } }) => {
        diagnostics.warn(false, PRECONDITION_INVALID, 'No handler for subject', { subject: message?.subject })
        try { message?.ack?.() } catch (_) { /* ignore */ }
      }
    })
    .error(({ error, message, rootCtx: { diagnostics } }) => {
      diagnostics.warn(false, PRECONDITION_INVALID, 'component provider router error', { error, subject: message?.subject })
      try { message?.ack?.() } catch (_) { /* ignore */ }
      return { status: 'errored' }
    })
    .abort(({ message, rootCtx: { diagnostics } }) => {
      diagnostics.debug('component provider router aborted', { subject: message?.subject })
      try { message?.ack?.() } catch (_) { /* ignore */ }
      return { status: 'aborted' }
    })
}

function createStore() {
  let value;
  return {
    get() { return value; },
    set(next) {
      value = next;
      return value;
    },
  };
}
