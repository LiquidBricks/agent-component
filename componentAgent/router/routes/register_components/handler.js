import { getAgentFns, getComponents } from '../../../componentOperations.js'
import { create as createSubject } from '@liquid-bricks/lib-nats-subject/create/basic'
import { PRECONDITION_REQUIRED } from '@liquid-bricks/lib-diagnostics/codes'
import { s } from '@liquid-bricks/lib-component-builder/component/builder/helper'

export async function handler({
  scope: { directories },
  rootCtx: { diagnostics, componentStore, agentFnStore, publish },
  routeCtx: { emits },
  message,
}) {
  const [components, agentFns] = await Promise.all([
    getComponents(directories, diagnostics),
    getAgentFns(directories, diagnostics),
  ])
  diagnostics.require(
    components.size > 0,
    PRECONDITION_REQUIRED,
    'No components found in directories: ' + directories.join(', '),
    { directories },
  )
  componentStore.set(components)
  agentFnStore.set(agentFns)

  const registrationSubject = createSubject(emits['component_service.cmd.component.register.v1']).forPublish()
    .env('prod')
    .build()

  for (const [, comp] of components) {
    const registration = await comp[s.INTERNALS].registration()
    await publish(registrationSubject, registration)
  }

  try { message?.ack?.() } catch (_) { /* ignore */ }

  return { status: 'registered', components: components.size, agentFns: agentFns.size }
}
