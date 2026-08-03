import { create as createSubject } from '@liquid-bricks/lib-nats-subject/create/basic'
import { COMPUTE_FUNCTION_STATUS } from './constants.js'
import {
  getPublishedTerminalStatus,
  hasComputeResultIdentity,
  markTerminalPublished,
  markTerminalPublishFailure,
} from './terminalEvent.js'

export async function publishComputeResultError({ error, scope, rootCtx: { publish }, routeCtx: { emits } }) {
  if (!hasComputeResultIdentity(scope) || getPublishedTerminalStatus(scope)) throw error

  const { instanceId, type, name } = scope
  const subject = createSubject(emits['gateway.function_result.evt.component.compute_function_failed.v1']).forPublish()
    .env('prod')

  try {
    await publish(
      subject.build(),
      {
        instanceId,
        name,
        type,
        status: COMPUTE_FUNCTION_STATUS.ERROR,
        error: serializeError(error),
      },
    )
  } catch (publishError) {
    throw markTerminalPublishFailure(publishError)
  }

  markTerminalPublished(scope, COMPUTE_FUNCTION_STATUS.ERROR)

  // Continue to the router-level handler. It acknowledges the command only
  // after this terminal event has been published successfully.
  throw error
}

function serializeError(error) {
  const payload = {
    name: typeof error?.name === 'string' && error.name.length ? error.name : 'Error',
    message: typeof error?.message === 'string' ? error.message : String(error),
  }

  if (typeof error?.code === 'string' || typeof error?.code === 'number') {
    payload.code = error.code
  }

  return payload
}
