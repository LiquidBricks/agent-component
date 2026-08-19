import { create as createSubject } from '@liquid-bricks/lib-nats-subject/create/basic'

export const COMPUTE_CONSOLE_EVENT = 'gateway.function_console.evt.console.*.v1.*'

export function publishComputeConsoleEvent({
  publish,
  emits,
  instanceId,
  name,
  type,
  method,
  args,
}) {
  const subject = createSubject(emits[COMPUTE_CONSOLE_EVENT]).forPublish()
    .env('prod')
    .action(method)
    .id(instanceId)

  return publish(subject.build(), {
    instanceId,
    name,
    type,
    method,
    args,
  })
}
