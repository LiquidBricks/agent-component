import test from 'node:test'
import assert from 'node:assert/strict'

import { diagnostics as makeDiagnostics } from '@liquid-bricks/lib-diagnostics'
import { spec as computeResultSpec } from '../../componentAgent/router/routes/compute_result.js'
import { s } from '@liquid-bricks/lib-component-builder/component/builder/helper'
import { agentFn as createAgentFn } from '../../../lib-component-builder/componentBuilder/index.js'

const noop = () => { }
function makeDiagnosticsInstance() {
  return makeDiagnostics({
    logger: { info: noop, warn: noop, error: noop, debug: noop },
    metrics: { timing: noop, count: noop },
    sample: () => true,
    rateLimit: () => true,
  })
}

test('gate fnc must return a boolean', async () => {
  const diagnostics = makeDiagnosticsInstance()

  await assert.rejects(
    () => computeResultSpec.handler({
      rootCtx: { diagnostics },
      scope: { node: { fnc: () => 'yes' }, deps: {}, type: 'gate', name: 'setup' },
    }),
    diagnostics.DiagnosticError,
  )

  const result = await computeResultSpec.handler({
    rootCtx: { diagnostics },
    scope: { node: { fnc: () => true }, deps: {}, type: 'gate', name: 'setup' },
  })
  assert.deepEqual(result, { result: true })
})

test('node fnc receives registered agentFns by alias', async () => {
  const diagnostics = makeDiagnosticsInstance()
  const component = {
    [s.INTERNALS]: {
      nodes: {
        agentFns: new Map([
          ['double', { portAddr: 'math.double', hash: 'hash-1' }],
        ]),
      },
    },
  }
  const agentFnStore = {
    get: () => new Map([
      ['math.double', { hash: 'hash-1', fn: (value) => value * 2 }],
    ]),
  }

  const result = await computeResultSpec.handler({
    rootCtx: { diagnostics, agentFnStore },
    scope: {
      component,
      node: { deps: ['agentFn.double'], fnc: ({ agentFn }) => agentFn.double(21) },
      deps: {},
      type: 'task',
      name: 'work',
      instanceId: 'instance-1',
    },
  })

  assert.deepEqual(result, { result: 42 })
})

test('agentFn hash mismatch fails execution', async () => {
  const diagnostics = makeDiagnosticsInstance()
  const component = {
    [s.INTERNALS]: {
      nodes: {
        agentFns: new Map([
          ['double', { portAddr: 'math.double', hash: 'expected' }],
        ]),
      },
    },
  }
  const agentFnStore = {
    get: () => new Map([
      ['math.double', { hash: 'actual', fn: (value) => value * 2 }],
    ]),
  }

  await assert.rejects(
    () => computeResultSpec.handler({
      rootCtx: { diagnostics, agentFnStore },
      scope: {
        component,
        node: { deps: ['agentFn.double'], fnc: ({ agentFn }) => agentFn.double(21) },
        deps: {},
        type: 'task',
        name: 'work',
        instanceId: 'instance-1',
      },
    }),
    diagnostics.DiagnosticError,
  )
})

test('agentFn without expected hash allows same portAddr with different implementations', async () => {
  const diagnostics = makeDiagnosticsInstance()
  const double = createAgentFn({ portAddr: 'math.transform', fn: (value) => value * 2 })
  const triple = createAgentFn({ portAddr: 'math.transform', fn: (value) => value * 3 })

  assert.notEqual(double.hash, triple.hash)

  const component = {
    [s.INTERNALS]: {
      nodes: {
        agentFns: new Map([
          ['transform', { portAddr: 'math.transform' }],
        ]),
      },
    },
  }

  async function runWithDiscoveredAgentFn(discoveredAgentFn) {
    const agentFnStore = {
      get: () => new Map([
        [
          discoveredAgentFn.portAddr,
          { hash: discoveredAgentFn.hash, fn: discoveredAgentFn.fn },
        ],
      ]),
    }

    return computeResultSpec.handler({
      rootCtx: { diagnostics, agentFnStore },
      scope: {
        component,
        node: { deps: ['agentFn.transform'], fnc: ({ agentFn }) => agentFn.transform(21) },
        deps: {},
        type: 'task',
        name: 'work',
        instanceId: `instance-${discoveredAgentFn.hash}`,
      },
    })
  }

  assert.deepEqual(await runWithDiscoveredAgentFn(double), { result: 42 })
  assert.deepEqual(await runWithDiscoveredAgentFn(triple), { result: 63 })
})

test('agentFns are exposed only when requested by node deps', async () => {
  const diagnostics = makeDiagnosticsInstance()
  const component = {
    [s.INTERNALS]: {
      nodes: {
        agentFns: new Map([
          ['double', { portAddr: 'math.double', hash: 'hash-1' }],
          ['triple', { portAddr: 'math.triple', hash: 'missing-hash' }],
        ]),
      },
    },
  }
  const agentFnStore = {
    get: () => new Map([
      ['math.double', { hash: 'hash-1', fn: (value) => value * 2 }],
    ]),
  }

  const result = await computeResultSpec.handler({
    rootCtx: { diagnostics, agentFnStore },
    scope: {
      component,
      node: {
        deps: ['agentFn.double'],
        fnc: ({ agentFn }) => ({
          double: agentFn.double(21),
          hasTriple: Object.hasOwn(agentFn, 'triple'),
        }),
      },
      deps: {},
      type: 'task',
      name: 'work',
      instanceId: 'instance-1',
    },
  })

  assert.deepEqual(result, { result: { double: 42, hasTriple: false } })
})
