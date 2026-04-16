import { decodeData } from '../middleware.js'
import { create as createSubject } from '@liquid-bricks/lib-nats-subject/create/basic'
import { createValidateExecutionRequest } from './helper.js'
import { Codes } from '../../codes.js'

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

async function executeNode({ rootCtx: { diagnostics }, scope: { node, instanceId, name, deps, type } }) {
  const result = await node.fnc({ deps });

  if (type === 'gate') {
    diagnostics.require(
      result === true || result === false,
      Codes.PRECONDITION_INVALID,
      'gate fnc must return true or false',
      { instanceId, name, type, result },
    )
  }

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
