const terminalStatusByScope = new WeakMap()
const terminalPublishFailures = new WeakSet()

const COMPUTE_TYPES = new Set(['data', 'gate', 'task'])

export function hasComputeResultIdentity(scope) {
  return scope != null
    && typeof scope.instanceId === 'string'
    && scope.instanceId.length > 0
    && typeof scope.name === 'string'
    && scope.name.length > 0
    && COMPUTE_TYPES.has(scope.type)
}

export function getPublishedTerminalStatus(scope) {
  return scope && typeof scope === 'object'
    ? terminalStatusByScope.get(scope)
    : undefined
}

export function markTerminalPublished(scope, status) {
  if (scope && typeof scope === 'object') terminalStatusByScope.set(scope, status)
}

export function markTerminalPublishFailure(error) {
  const failure = error instanceof Error
    ? error
    : new Error('compute result terminal event publication failed', { cause: error })
  terminalPublishFailures.add(failure)
  return failure
}

export function isTerminalPublishFailure(error) {
  return error instanceof Error && terminalPublishFailures.has(error)
}
