import { decodeData } from '../middleware.js'
import { getComponents } from '../../../componentAgent/componentOperations.js'
import { create as createSubject } from '@liquid-bricks/lib-nats-subject/create/basic'
import { Codes } from '../../../componentAgent/codes.js'
import { s } from '@liquid-bricks/lib-component-builder/component/builder/helper'

export const path = { channel: 'cmd', entity: 'agent', action: 'register-components' }
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

async function registerComponentsAndPublish({ scope: { directories }, rootCtx: { diagnostics, componentStore, publish }, message }) {
  const components = await getComponents(directories, diagnostics)
  diagnostics.require(
    components.size > 0,
    Codes.PRECONDITION_REQUIRED,
    'No components found in directories: ' + directories.join(', '),
    { directories },
  )
  componentStore.set(components)

  const registrationSubject = createSubject()
    .env('prod')
    .ns('component-service')
    .context('component-agent')
    .entity('component')
    .channel('cmd')
    .action('register')
    .version('v1')
    .build()

  for (const [, comp] of components) {
    const registration = await comp[s.INTERNALS].registration()
    await publish(registrationSubject, registration)
  }

  try { message?.ack?.() } catch (_) { /* ignore */ }

  return { status: 'registered', components: components.size }
}
