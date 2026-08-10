import test from 'node:test'
import assert from 'node:assert/strict'

import { diagnostics as makeDiagnostics } from '@liquid-bricks/lib-diagnostics'
import { handler } from '../../componentAgent/router/routes/compute_function/handler.js'
import { publishComputeResultDone } from '../../componentAgent/router/routes/compute_function/publishComputeResultDone.js'
import { spec as computeFunctionSpec } from '../../componentAgent/router/routes/compute_function/index.js'
import { createExecutionRouter } from '../../componentAgent/router/index.js'
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
    () => handler({
      rootCtx: { diagnostics },
      scope: { node: { fnc: () => 'yes' }, deps: {}, type: 'gate', name: 'setup' },
    }),
    diagnostics.DiagnosticError,
  )

  await assert.rejects(
    () => handler({
      rootCtx: { diagnostics },
      scope: { node: { fnc: () => { } }, deps: {}, type: 'gate', name: 'setup' },
    }),
    diagnostics.DiagnosticError,
  )

  const trueResult = await handler({
    rootCtx: { diagnostics },
    scope: { node: { fnc: () => true }, deps: {}, type: 'gate', name: 'setup' },
  })
  assert.deepEqual(trueResult, { result: true })

  const falseResult = await handler({
    rootCtx: { diagnostics },
    scope: { node: { fnc: () => false }, deps: {}, type: 'gate', name: 'setup' },
  })
  assert.deepEqual(falseResult, { result: false })
})

test('data and task functions without return values publish provided null results', async () => {
  const diagnostics = makeDiagnosticsInstance()
  const published = []

  for (const type of ['data', 'task']) {
    const execution = await handler({
      rootCtx: { diagnostics },
      scope: {
        node: { fnc: () => { } },
        deps: {},
        name: 'voidResult',
        type,
      },
    })
    const scope = {
      instanceId: `instance-${type}`,
      name: 'voidResult',
      type,
      ...execution,
    }
    await publishComputeResultDone({
      scope,
      rootCtx: {
        publish: async (subject, data) => {
          published.push(JSON.parse(JSON.stringify({ subject, data })))
        },
      },
      routeCtx: computeFunctionSpec.context,
    })
  }

  assert.deepEqual(published, [
    {
      subject: 'prod.gateway._.function_result.evt.component.compute_function.v1._',
      data: {
        instanceId: 'instance-data',
        name: 'voidResult',
        type: 'data',
        result: null,
        status: 'provided',
      },
    },
    {
      subject: 'prod.gateway._.function_result.evt.component.compute_function.v1._',
      data: {
        instanceId: 'instance-task',
        name: 'voidResult',
        type: 'task',
        result: null,
        status: 'provided',
      },
    },
  ])
})

test('handler failures publish an error result before reaching the global router error handler', async () => {
  const diagnostics = makeDiagnosticsInstance()
  const componentHash = 'component-hash'
  const executionError = Object.assign(new Error('task exploded'), { code: 'TASK_EXPLODED' })
  const brokenComponent = {
    [s.INTERNALS]: {
      nodes: {
        data: new Map(),
        tasks: new Map([
          ['explode', { fnc: () => { throw executionError } }],
        ]),
        gates: new Map(),
        agentFns: new Map(),
      },
    },
  }
  const published = []
  const router = createExecutionRouter({
    diagnostics,
    publish: async (subject, data) => published.push({ subject, data }),
  })
  router.context.componentStore.set(new Map([[componentHash, brokenComponent]]))

  let acknowledgements = 0
  const subject = 'prod.agent._._.cmd.component.compute_function.v1._'
  const response = await router.request({
    subject,
    message: {
      subject,
      data: {
        instanceId: 'instance-1',
        deps: {},
        componentHash,
        name: 'explode',
        type: 'task',
      },
      ack() { acknowledgements += 1 },
    },
  })

  assert.deepEqual(published, [{
    subject: 'prod.gateway._.function_result.evt.component.compute_function_failed.v1._',
    data: {
      instanceId: 'instance-1',
      name: 'explode',
      type: 'task',
      status: 'error',
      error: {
        name: 'Error',
        message: 'task exploded',
        code: 'TASK_EXPLODED',
      },
    },
  }])
  assert.equal(response.scope.status, 'errored')
  assert.equal(response.scope.error, executionError)
  assert.equal(acknowledgements, 1)
})

test('pre failures publish one error result when compute identity is available', async () => {
  const diagnostics = makeDiagnosticsInstance()
  const published = []
  const router = createExecutionRouter({
    diagnostics,
    publish: async (subject, data) => published.push({ subject, data }),
  })
  router.context.componentStore.set(new Map())

  let acknowledgements = 0
  const subject = 'prod.agent._._.cmd.component.compute_function.v1._'
  const response = await router.request({
    subject,
    message: {
      subject,
      data: {
        instanceId: 'instance-pre-error',
        deps: {},
        componentHash: 'missing-component',
        name: 'work',
        type: 'task',
      },
      ack() { acknowledgements += 1 },
    },
  })

  assert.equal(published.length, 1)
  assert.equal(published[0].data.instanceId, 'instance-pre-error')
  assert.equal(published[0].data.name, 'work')
  assert.equal(published[0].data.type, 'task')
  assert.equal(published[0].data.status, 'error')
  assert.equal(Object.hasOwn(published[0].data, 'result'), false)
  assert.equal(published[0].subject, 'prod.gateway._.function_result.evt.component.compute_function_failed.v1._')
  assert.equal(published[0].data.error.message, 'component not found for execution')
  assert.equal(response.scope.status, 'errored')
  assert.equal(acknowledgements, 1)
})

test('a provided-result post failure publishes one error terminal result', async () => {
  const diagnostics = makeDiagnosticsInstance()
  const componentHash = 'post-failure-component'
  const postError = new Error('provided result publish failed')
  const component = {
    [s.INTERNALS]: {
      nodes: {
        data: new Map(),
        tasks: new Map([
          ['work', { fnc: () => 42 }],
        ]),
        gates: new Map(),
        agentFns: new Map(),
      },
    },
  }
  const attempts = []
  const delivered = []
  const router = createExecutionRouter({
    diagnostics,
    publish: async (subject, data) => {
      attempts.push(data.status)
      if (data.status === 'provided') throw postError
      delivered.push({ subject, data })
    },
  })
  router.context.componentStore.set(new Map([[componentHash, component]]))

  let acknowledgements = 0
  const subject = 'prod.agent._._.cmd.component.compute_function.v1._'
  const response = await router.request({
    subject,
    message: {
      subject,
      data: {
        instanceId: 'instance-post-error',
        deps: {},
        componentHash,
        name: 'work',
        type: 'task',
      },
      ack() { acknowledgements += 1 },
    },
  })

  assert.deepEqual(attempts, ['provided', 'error'])
  assert.equal(delivered.length, 1)
  assert.equal(delivered[0].subject, 'prod.gateway._.function_result.evt.component.compute_function_failed.v1._')
  assert.equal(delivered[0].data.status, 'error')
  assert.equal(Object.hasOwn(delivered[0].data, 'result'), false)
  assert.deepEqual(delivered[0].data.error, {
    name: 'Error',
    message: postError.message,
  })
  assert.equal(response.scope.error, postError)
  assert.equal(response.scope.status, 'errored')
  assert.equal(acknowledgements, 1)
})

test('terminal error publication failure is nacked, not acked, and rejects for retry', async () => {
  const diagnostics = makeDiagnosticsInstance()
  const componentHash = 'terminal-publish-failure-component'
  const executionError = new Error('task exploded')
  const publicationError = new Error('terminal result transport failed')
  const component = {
    [s.INTERNALS]: {
      nodes: {
        data: new Map(),
        tasks: new Map([
          ['explode', { fnc: () => { throw executionError } }],
        ]),
        gates: new Map(),
        agentFns: new Map(),
      },
    },
  }
  let publishAttempts = 0
  const router = createExecutionRouter({
    diagnostics,
    publish: async () => {
      publishAttempts += 1
      throw publicationError
    },
  })
  router.context.componentStore.set(new Map([[componentHash, component]]))

  let acknowledgements = 0
  let negativeAcknowledgements = 0
  const subject = 'prod.agent._._.cmd.component.compute_function.v1._'
  await assert.rejects(
    () => router.request({
      subject,
      message: {
        subject,
        data: {
          instanceId: 'instance-terminal-publish-error',
          deps: {},
          componentHash,
          name: 'explode',
          type: 'task',
        },
        ack() { acknowledgements += 1 },
        nak() { negativeAcknowledgements += 1 },
      },
    }),
    (error) => error === publicationError,
  )

  assert.equal(publishAttempts, 1)
  assert.equal(acknowledgements, 0)
  assert.equal(negativeAcknowledgements, 1)
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

  const result = await handler({
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
    () => handler({
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

    return handler({
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

  const result = await handler({
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
