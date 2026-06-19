import { Codes } from '../../../codes.js'
import { s } from '@liquid-bricks/lib-component-builder/component/builder/helper'

export async function handler({ rootCtx: { diagnostics, agentFnStore }, scope: { component, node, instanceId, name, deps, type } }) {
  const agentFn = buildAgentFnContext({ diagnostics, agentFnStore, component, node, instanceId, name, type })
  const result = await node.fnc({ deps, agentFn })

  if (type === 'gate') {
    diagnostics.require(
      result === true || result === false,
      Codes.PRECONDITION_INVALID,
      'gate fnc must return true or false',
      { instanceId, name, type, result },
    )
  }

  return { result }
}

function buildAgentFnContext({ diagnostics, agentFnStore, component, node, instanceId, name, type }) {
  const requestedAliases = getRequestedAgentFnAliases(node)
  if (requestedAliases.size === 0) return {}

  const registeredAgentFns = component?.[s.INTERNALS]?.nodes?.agentFns
  diagnostics.require(
    registeredAgentFns && registeredAgentFns.size > 0,
    Codes.PRECONDITION_INVALID,
    'agentFn alias not registered on component',
    { instanceId, name, type, aliases: Array.from(requestedAliases) },
  )

  const agentFns = agentFnStore?.get?.()
  diagnostics.require(
    agentFns,
    Codes.PRECONDITION_REQUIRED,
    'agentFn store is empty',
    { instanceId, name, type },
  )

  const context = {}
  for (const alias of requestedAliases) {
    const registered = registeredAgentFns.get(alias)
    diagnostics.require(
      registered,
      Codes.PRECONDITION_INVALID,
      'agentFn alias not registered on component',
      { instanceId, name, type, alias },
    )

    const { portAddr, hash } = registered
    const agentFn = agentFns.get(portAddr)
    diagnostics.require(
      agentFn,
      Codes.PRECONDITION_INVALID,
      'agentFn not found for execution',
      { instanceId, name, type, alias, portAddr },
    )
    diagnostics.require(
      !hash || hash === agentFn.hash,
      Codes.PRECONDITION_INVALID,
      'agentFn hash mismatch',
      { instanceId, name, type, alias, portAddr, expectedHash: hash, actualHash: agentFn.hash },
    )
    context[alias] = agentFn.fn
  }

  return context
}

function getRequestedAgentFnAliases(node) {
  const deps = Array.isArray(node?.deps) ? node.deps : []
  return new Set(
    deps
      .map((dep) => String(dep ?? '').trim().split('.'))
      .filter((parts) => parts.length === 2 && parts[0] === 'agentFn' && parts[1])
      .map((parts) => parts[1]),
  )
}
