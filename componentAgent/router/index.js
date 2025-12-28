import { router } from '@liquid-bricks/lib-nats-subject';
import { Codes } from '../../componentAgent/codes.js'
import { path as computeResultPath, spec as computeResultSpec } from './routes/compute_result.js'
import { path as initServicePath, spec as initServiceSpec } from './routes/init_service.js'
import { path as registerComponentsPath, spec as registerComponentsSpec } from './routes/register_components.js'

export function createExecutionRouter({
  diagnostics,
  publish,
}) {
  return router({
    tokens: ['env', 'ns', 'tenant', 'context', 'channel', 'entity', 'action', 'version', 'id'],
    context: { publish, diagnostics, componentStore: createComponentStore(), serviceStore: createServiceStore() },
  })
    .route(registerComponentsPath, registerComponentsSpec)
    .route(initServicePath, initServiceSpec)
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

function createServiceStore() {
  const services = new Map();
  return {
    get(key) {
      if (key === undefined) return services;
      return services.get(key);
    },
    set(key, service) {
      services.set(key, service);
      return service;
    },
  };
}
