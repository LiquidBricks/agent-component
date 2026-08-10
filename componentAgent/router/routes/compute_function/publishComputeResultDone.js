import { create as createSubject } from '@liquid-bricks/lib-nats-subject/create/basic'
import { COMPUTE_FUNCTION_STATUS } from './constants.js'
import { getPublishedTerminalStatus, markTerminalPublished } from './terminalEvent.js'

export async function publishComputeResultDone({ scope, rootCtx: { publish }, routeCtx: { emits } }) {
  if (getPublishedTerminalStatus(scope)) return

  const { instanceId, result, type, name } = scope
  const publishedResult = result === undefined ? null : result
  const subject = createSubject(emits['gateway.function_result.evt.component.compute_function.v1']).forPublish()
    .env('prod')

  await publish(
    subject.build(),
    { instanceId, name, type, result: publishedResult, status: COMPUTE_FUNCTION_STATUS.PROVIDED },
  )

  markTerminalPublished(scope, COMPUTE_FUNCTION_STATUS.PROVIDED)
}
