import { decodeData } from '../middleware.js'
import { create as createSubject } from '@liquid-bricks/lib-nats-subject/create/basic'
import { createValidateExecutionRequest } from './helper.js'

export const path = { channel: 'exec', entity: 'component', action: 'compute_result' }
export const spec = {
  decode: [
    decodeData(['instanceId', 'deps', 'componentHash', 'name', 'type']),
  ],
  pre: [
    createValidateExecutionRequest(),
  ],
  handler: executeNode,
  post: [
    publishComputedResult,
  ],
}

async function executeNode({ rootCtx: { diagnostics }, scope: { node, instanceId, name, deps } }) {
  const result = await node.fnc({ deps });
  return { result };
}


async function publishComputedResult({ scope, rootCtx: { publish, diagnostics } }) {
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
