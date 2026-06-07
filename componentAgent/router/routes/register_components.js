import { decodeData } from '../middleware.js'
import { getAgentFns, getComponents } from '../../../componentAgent/componentOperations.js'
import { create as createSubject } from '@liquid-bricks/lib-nats-subject/create/basic'
import { Codes } from '../../../componentAgent/codes.js'
import { s } from '@liquid-bricks/lib-component-builder/component/builder/helper'

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
    ensureDirectoriesProvided,
  ],
  handler: registerComponentsAndPublish,
}

function ensureDirectoriesProvided({ scope: { directories }, rootCtx: { diagnostics } }) {
  diagnostics.require(Array.isArray(directories), Codes.PRECONDITION_INVALID, 'directories must be an array', { field: 'directories' })
  diagnostics.require(directories.length > 0, Codes.PRECONDITION_REQUIRED, 'directories is required', { field: 'directories' })
}

async function registerComponentsAndPublish({ scope: { directories }, rootCtx: { diagnostics, componentStore, agentFnStore, publish }, message }) {
  const [components, agentFns] = await Promise.all([
    getComponents(directories, diagnostics),
    getAgentFns(directories, diagnostics),
  ])
  diagnostics.require(
    components.size > 0,
    Codes.PRECONDITION_REQUIRED,
    'No components found in directories: ' + directories.join(', '),
    { directories },
  )
  componentStore.set(components)
  agentFnStore.set(agentFns)

  const registrationSubject = createSubject(natsEvents['*'].component_service['*']['*'].cmd.component.register.v1['*']).forPublish()
    .env('prod')
    .context('component-agent')
    .build()

  for (const [, comp] of components) {
    const registration = await comp[s.INTERNALS].registration()
    await publish(registrationSubject, registration)
  }

  try { message?.ack?.() } catch (_) { /* ignore */ }

  return { status: 'registered', components: components.size, agentFns: agentFns.size }
}
