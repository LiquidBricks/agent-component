import { decodeData } from '../middleware.js'
import { create as createSubject } from '@liquid-bricks/lib-nats-subject/create/basic'
import { Codes } from '../../../componentAgent/codes.js'
import { createValidateExecutionRequest } from './helper.js'

export const path = { channel: 'cmd', entity: 'component', action: 'init_service' }
export const spec = {
  decode: [
    decodeData(['instanceId', 'deps', 'componentHash', 'name', 'type']),
  ],
  pre: [
    createValidateExecutionRequest({ allowedTypes: ['service'] }),
    addServiceKey,
  ],
  handler: executeServiceNode,
  post: [
    publishComputedResult,
  ],
}

function addServiceKey({ scope, rootCtx: { diagnostics, serviceStore } }) {
  diagnostics.require(serviceStore?.get?.(), Codes.PRECONDITION_REQUIRED, 'service store is empty', { field: 'services' });
  const { instanceId, type, componentHash, name } = scope;
  const serviceKey = `${componentHash}.${type}.${name}.${instanceId}`;
  return { serviceKey };
}

async function executeServiceNode({ rootCtx: { serviceStore }, scope: { node, deps, serviceKey } }) {
  const serviceInstance = await node.fnc({ deps });
  serviceStore.set(serviceKey, serviceInstance);
  return { result: true };
}

async function publishComputedResult({ scope, rootCtx: { publish } }) {
  const { instanceId, result, type, name } = scope;
  const subject = createSubject()
    .env('prod')
    .ns('component-service')
    .context('component-agent')
    .entity('component')
    .channel('evt')
    .action(`result_computed`)
    .version('v1');

  await publish(
    subject.build(),
    { instanceId, name, type, result }
  );
}
