import { router } from '@liquid-bricks/lib-nats-subject';
import { Codes } from '../../componentAgent/codes.js'
import { path as computeResultPath, spec as computeResultSpec } from './routes/compute_result.js'
import { path as registerComponentsPath, spec as registerComponentsSpec } from './routes/register_components.js'

export function createExecutionRouter({
  diagnostics,
  publish,
}) {
  return router({
    tokens: ['env', 'ns', 'tenant', 'context', 'channel', 'entity', 'action', 'version', 'id'],
    context: { publish, diagnostics, componentStore: createComponentStore() },
  })
    .route(registerComponentsPath, registerComponentsSpec)
    .route(computeResultPath, computeResultSpec)
    .default({
      handler: ({ message, rootCtx: { diagnostics } }) => {
        diagnostics.warn(false, Codes.PRECONDITION_INVALID, 'No handler for subject', { subject: message?.subject })
        try { message?.ack?.() } catch (_) { /* ignore */ }
      }
    })
    .error(({ error, message, rootCtx: { diagnostics } }) => {
      diagnostics.warn(false, Codes.PRECONDITION_INVALID, 'component provider router error', { error, subject: message?.subject })
      try { message?.ack?.() } catch (_) { /* ignore */ }
      return { status: 'errored' }
    })
    .abort(({ message, rootCtx: { diagnostics } }) => {
      diagnostics.debug('component provider router aborted', { subject: message?.subject })
      try { message?.ack?.() } catch (_) { /* ignore */ }
      return { status: 'aborted' }
    })
}

function createComponentStore() {
  let components;
  return {
    get() { return components; },
    set(next) {
      components = next;
      return components;
    },
  };
}
