import test from 'node:test'
import assert from 'node:assert/strict'

import { diagnostics as makeDiagnostics } from '@liquid-bricks/lib-diagnostics'
import { handler } from '../../componentAgent/router/routes/compute_function/handler.js'
import { spec as computeFunctionSpec } from '../../componentAgent/router/routes/compute_function/index.js'

const noop = () => {}

function makeDiagnosticsInstance() {
  return makeDiagnostics({
    logger: { info: noop, warn: noop, error: noop, debug: noop },
    metrics: { timing: noop, count: noop },
    sample: () => true,
    rateLimit: () => true,
  })
}

function execute({ instanceId, fnc, publish }) {
  return handler({
    rootCtx: {
      diagnostics: makeDiagnosticsInstance(),
      publish,
    },
    routeCtx: computeFunctionSpec.context,
    scope: {
      node: { fnc },
      deps: {},
      instanceId,
      name: 'consoleTask',
      type: 'task',
    },
  })
}

test('compute functions stream console methods as distinct invocation events', async () => {
  const published = []
  const methods = ['log', 'info', 'debug', 'warn', 'error', 'dir', 'table', 'trace']
    .filter((method) => typeof console[method] === 'function')

  const result = await execute({
    instanceId: 'instance-console',
    publish: async (subject, data) => published.push({ subject, data }),
    fnc: async () => {
      for (const method of methods) {
        console[method]('message', { method })
        await Promise.resolve()
      }
      return 42
    },
  })

  assert.deepEqual(result, { result: 42 })
  assert.equal(published.length, methods.length)

  for (const [index, method] of methods.entries()) {
    assert.equal(
      published[index].subject,
      `prod.gateway._.function_console.evt.console.${method}.v1.instance-console`,
    )
    assert.deepEqual(published[index].data, {
      instanceId: 'instance-console',
      name: 'consoleTask',
      type: 'task',
      method,
      args: ['message', { method }],
    })
  }
})

test('concurrent compute functions keep console streams isolated', async () => {
  const published = []
  const releases = new Map()

  const run = (instanceId) => execute({
    instanceId,
    publish: async (subject, data) => published.push({ subject, data }),
    fnc: async () => {
      console.log('start', instanceId)
      await new Promise((resolve) => releases.set(instanceId, resolve))
      console.warn('end', instanceId)
      return instanceId
    },
  })

  const first = run('instance-a')
  const second = run('instance-b')

  releases.get('instance-b')()
  await second
  releases.get('instance-a')()
  await first

  assert.deepEqual(
    published.map(({ subject, data }) => ({ subject, method: data.method, args: data.args })),
    [
      {
        subject: 'prod.gateway._.function_console.evt.console.log.v1.instance-a',
        method: 'log',
        args: ['start', 'instance-a'],
      },
      {
        subject: 'prod.gateway._.function_console.evt.console.log.v1.instance-b',
        method: 'log',
        args: ['start', 'instance-b'],
      },
      {
        subject: 'prod.gateway._.function_console.evt.console.warn.v1.instance-b',
        method: 'warn',
        args: ['end', 'instance-b'],
      },
      {
        subject: 'prod.gateway._.function_console.evt.console.warn.v1.instance-a',
        method: 'warn',
        args: ['end', 'instance-a'],
      },
    ],
  )
})

test('console events after a compute function settles are dropped', async () => {
  const published = []
  let lateLogCompleted
  const lateLog = new Promise((resolve) => { lateLogCompleted = resolve })

  await execute({
    instanceId: 'instance-late',
    publish: async (subject, data) => published.push({ subject, data }),
    fnc: () => {
      console.log('during execution')
      setTimeout(() => {
        console.error('after execution')
        lateLogCompleted()
      }, 0)
    },
  })

  await lateLog

  assert.equal(published.length, 1)
  assert.equal(published[0].data.method, 'log')
  assert.deepEqual(published[0].data.args, ['during execution'])
})

test('console transport failures do not fail compute execution', async () => {
  const transportError = new Error('console transport unavailable')

  const result = await execute({
    instanceId: 'instance-transport-error',
    publish: async () => { throw transportError },
    fnc: () => {
      console.error('still best effort')
      return 'completed'
    },
  })

  assert.deepEqual(result, { result: 'completed' })
})
