import { decodeData } from '../../middleware.js'
import { create as createSubject } from '@liquid-bricks/lib-nats-subject/create/basic'
import { handler } from './handler.js'
import { publishComputeResultDone } from './publishComputeResultDone.js'
import { publishComputeResultError } from './publishComputeResultError.js'
import { COMPUTE_CONSOLE_EVENT } from './publishComputeConsoleEvent.js'
import { validatePayload } from './validatePayload.js'

import { events as natsEvents } from '@liquid-bricks/lib-nats-subject/events/nats'


export const path = createSubject(natsEvents['*'].agent['*']['*'].cmd.component.compute_function.v1['*'])
  .forSubscribe()
  .toObject()

export const emits = {
  [COMPUTE_CONSOLE_EVENT]:
    natsEvents['*'].gateway['*'].function_console.evt.console['*'].v1['*'],
  'gateway.function_result.evt.component.compute_function.v1':
    natsEvents['*'].gateway['*'].function_result.evt.component.compute_function.v1['*'],
  'gateway.function_result.evt.component.compute_function_failed.v1':
    natsEvents['*'].gateway['*'].function_result.evt.component.compute_function_failed.v1['*'],
}

export const spec = {
  context: { emits },
  decode: [
    decodeData(['instanceId', 'deps', 'componentHash', 'name', 'type']),
  ],
  pre: [
    validatePayload,
  ],
  handler,
  onError: [
    publishComputeResultError,
  ],
  post: [
    publishComputeResultDone,
  ],
}
