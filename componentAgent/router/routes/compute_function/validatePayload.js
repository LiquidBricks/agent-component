import { Codes } from '../../../codes.js'
import { s } from '@liquid-bricks/lib-component-builder/component/builder/helper'

const typeToNodeAccessor = {
  data: (component) => component[s.INTERNALS].nodes.data,
  task: (component) => component[s.INTERNALS].nodes.tasks,
  gate: (component) => component[s.INTERNALS].nodes.gates,
}

const allowedTypes = Object.keys(typeToNodeAccessor)

export function validatePayload({ scope, rootCtx: { diagnostics, componentStore } }) {
  const { instanceId, type, componentHash, name } = scope
  diagnostics.require(typeof instanceId === 'string' && instanceId.length, Codes.PRECONDITION_REQUIRED, 'instanceId is required', { field: 'instanceId' })
  diagnostics.require(typeof componentHash === 'string' && componentHash.length, Codes.PRECONDITION_REQUIRED, 'componentHash is required', { field: 'componentHash' })
  diagnostics.require(typeof type === 'string' && allowedTypes.includes(type), Codes.PRECONDITION_INVALID, `type must be one of: ${allowedTypes.join(', ')}`, { field: 'type', type })
  diagnostics.require(typeof name === 'string' && name.length, Codes.PRECONDITION_REQUIRED, `${type} name is required`, { field: 'name' })

  const components = componentStore?.get?.()
  diagnostics.require(components, Codes.PRECONDITION_REQUIRED, 'component store is empty', { field: 'components' })

  const component = components.get(componentHash)
  diagnostics.require(component, Codes.PRECONDITION_INVALID, 'component not found for execution', { componentHash })

  const nodeAccessor = typeToNodeAccessor[type]
  const nodeCollection = nodeAccessor?.(component)
  diagnostics.require(nodeCollection, Codes.PRECONDITION_INVALID, `${type} collection not found on component`, { componentHash, type })

  const node = nodeCollection.get(name)
  diagnostics.require(node, Codes.PRECONDITION_INVALID, `${type} node not found on component`, { componentHash, name })

  return { component, node }
}
