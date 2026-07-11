import { create as createSubject } from '@liquid-bricks/lib-nats-subject/create/basic'

export async function publishComputeResultDone({ scope, rootCtx: { publish }, routeCtx: { emits } }) {
  const { instanceId, result, type, name } = scope
  const subject = createSubject(emits['gateway.function_result.evt.component.compute_function.v1']).forPublish()
    .env('prod')

  await publish(
    subject.build(),
    { instanceId, name, type, result },
  )
}
