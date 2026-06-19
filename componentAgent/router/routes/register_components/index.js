import { decodeData } from '../../middleware.js'
import { create as createSubject } from '@liquid-bricks/lib-nats-subject/create/basic'
import { handler } from './handler.js'
import { validatePayload } from './validatePayload.js'

import { events as natsEvents } from '@liquid-bricks/lib-nats-subject/events/nats'


export const path = createSubject(natsEvents['*'].component_service['*']['*'].cmd.agent.register_components.v1['*'])
  .forSubscribe()
  .context('component-agent')
  .toObject()

export const spec = {
  decode: [
    decodeData(['directories']),
  ],
  pre: [
    validatePayload,
  ],
  handler,
}
