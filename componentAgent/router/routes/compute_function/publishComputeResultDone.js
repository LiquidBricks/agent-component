import { create as createSubject } from '@liquid-bricks/lib-nats-subject/create/basic'
import { events as natsEvents } from '@liquid-bricks/lib-nats-subject/events/nats'

export async function publishComputeResultDone({ scope, rootCtx: { publish } }) {
  const { instanceId, result, type, name } = scope
  const subject = createSubject(natsEvents['*'].gateway['*'].function_result.evt.component.compute_function.v1['*']).forPublish()
    .env('prod')

  await publish(
    subject.build(),
    { instanceId, name, type, result },
  )
}
