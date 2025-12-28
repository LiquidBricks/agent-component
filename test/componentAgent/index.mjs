import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { WebSocketServer } from 'ws'

import { createComponentAgent, createExecutionRouter } from '../../index.js'
import { diagnostics } from '@liquid-bricks/lib-diagnostics'
import { component } from '@liquid-bricks/lib-component-builder/component/builder'
import { s } from '@liquid-bricks/lib-component-builder/component/builder/helper'
import { create as createSubject } from '@liquid-bricks/lib-nats-subject/create/basic'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const builderImportPath = '@liquid-bricks/lib-component-builder/component/builder'
const tmpComponentsDir = path.join(__dirname, 'tmpComponents')

const defaultMetrics = { count() { }, timing() { } }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function createMemoryLogger() {
  const entries = []
  const logger = {}
  for (const level of ['info', 'warn', 'error', 'debug']) {
    logger[level] = (entry) => entries.push({ level, ...entry })
  }
  return { logger, entries }
}

async function startWebSocketServer(t) {
  const wss = new WebSocketServer({ port: 0 })
  const messages = []
  const connections = new Set()

  wss.on('connection', (ws) => {
    connections.add(ws)
    ws.on('message', (raw) => {
      try { messages.push(JSON.parse(String(raw))) }
      catch (error) { messages.push({ parseError: error, raw: String(raw) }) }
    })
    ws.on('close', () => connections.delete(ws))
  })

  await once(wss, 'listening')
  const port = wss.address().port

  t.after(async () => {
    for (const ws of connections) {
      try { ws.removeAllListeners() } catch { }
      try { ws.terminate() } catch { }
    }
    await new Promise((resolve) => wss.close(() => resolve()))
  })

  return {
    wss,
    port,
    messages,
    broadcast(payload) {
      const data = typeof payload === 'string' ? payload : JSON.stringify(payload)
      for (const ws of connections) ws.send(data)
    },
  }
}

async function waitForMessage(messages, predicate = () => true, timeoutMs = 2000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const found = messages.find(predicate)
    if (found) return found
    await sleep(10)
  }
  return null
}

async function createComponentModule({
  name,
  fileName = `${name}.comp.js`,
  delayMs = 0,
  definition,
}) {
  await fs.mkdir(tmpComponentsDir, { recursive: true })
  const dir = await fs.mkdtemp(path.join(tmpComponentsDir, `component-agent-${name}-`))
  const filePath = path.join(dir, fileName)

  const delayLine = delayMs > 0 ? `await new Promise((resolve) => setTimeout(resolve, ${delayMs}));\n` : ''
  const source = [
    `import { component } from '${builderImportPath}';`,
    delayLine,
    `const componentName = ${JSON.stringify(name)};`,
    `const comp = (${definition})(componentName);`,
    'export default comp;',
    '',
  ].join('\n')

  await fs.writeFile(filePath, source, 'utf8')
  const mod = await import(pathToFileURL(filePath).href)

  return {
    dir,
    filePath,
    component: mod.default,
    registration: mod.default[s.INTERNALS].registration(),
    hash: mod.default[s.INTERNALS].hash(),
  }
}

test('component agent registers discovered components on connect', async (t) => {
  const { logger } = createMemoryLogger()
  const diag = diagnostics({ logger, metrics: defaultMetrics })

  const componentName = 'reg-component'
  const fixture = await createComponentModule({
    name: componentName,
    definition: () => component('reg-component')
      .data('value', { fnc: () => 7 })
      .task('double', {
        deps: ({ data: { value } }) => value,
        fnc: ({ deps: { data: { value } } }) => value * 2,
      }),
  })
  t.after(() => fs.rm(fixture.dir, { recursive: true, force: true }))

  const server = await startWebSocketServer(t)
  const agent = createComponentAgent({
    ipAddress: '127.0.0.1',
    port: server.port,
    directories: [fixture.dir],
    diagnostics: diag,
  })

  const registrationSubject = createSubject()
    .env('prod')
    .ns('component-service')
    .context('component-agent')
    .entity('component')
    .channel('cmd')
    .action('register')
    .version('v1')
    .build()

  const message = await waitForMessage(
    server.messages,
    (m) => m.subject === registrationSubject,
  )

  assert.ok(message, 'expected registration message from agent')
  assert.equal(message.subject, registrationSubject)
  assert.equal(message.data.name, fixture.registration.name)
  assert.equal(message.data.hash, fixture.registration.hash)
  assert.deepEqual(
    message.data.tasks.map(({ name }) => name),
    fixture.registration.tasks.map(({ name }) => name),
  )

  agent.removeAllListeners()
  agent.close()
})

test('agent re-registers components on register-components command', async (t) => {
  const { logger } = createMemoryLogger()
  const diag = diagnostics({ logger, metrics: defaultMetrics })

  const componentName = 'cmd-register-component'
  const fixture = await createComponentModule({
    name: componentName,
    definition: () => component(componentName)
      .data('value', { fnc: () => 42 }),
  })
  t.after(() => fs.rm(fixture.dir, { recursive: true, force: true }))

  const server = await startWebSocketServer(t)
  const connectionPromise = once(server.wss, 'connection')

  const agent = createComponentAgent({
    ipAddress: '127.0.0.1',
    port: server.port,
    directories: [fixture.dir],
    diagnostics: diag,
  })

  const [ws] = await connectionPromise

  const registrationSubject = createSubject()
    .env('prod')
    .ns('component-service')
    .context('component-agent')
    .entity('component')
    .channel('cmd')
    .action('register')
    .version('v1')
    .build()

  const initialRegistration = await waitForMessage(
    server.messages,
    (m) => m.subject === registrationSubject,
  )
  assert.ok(initialRegistration, 'expected initial registration message')
  server.messages.length = 0

  const registerComponentsCmdSubject = createSubject()
    .env('prod')
    .ns('component-service')
    .context('component-agent')
    .channel('cmd')
    .entity('agent')
    .action('register-components')
    .version('v1')
    .build()

  ws.send(JSON.stringify({
    subject: registerComponentsCmdSubject,
    data: { directories: [fixture.dir], reason: 'test' },
  }))

  const rerunRegistration = await waitForMessage(
    server.messages,
    (m) => m.subject === registrationSubject,
  )

  assert.ok(rerunRegistration, 'expected registration message after register-components command')
  assert.equal(rerunRegistration.data.name, fixture.registration.name)
  assert.equal(rerunRegistration.data.hash, fixture.registration.hash)

  agent.removeAllListeners()
  agent.close()
})

test('queued compute_result requests are processed once the router is ready', async (t) => {
  const { logger } = createMemoryLogger()
  const diag = diagnostics({ logger, metrics: defaultMetrics })

  const componentName = 'compute-comp'
  const fixture = await createComponentModule({
    name: componentName,
    delayMs: 50,
    definition: () => component('compute-comp')
      .task('add', {
        deps: ({ deps: { inputs } }) => inputs,
        fnc: ({ deps: { inputs } }) => inputs.a + inputs.b,
      }),
  })
  t.after(() => fs.rm(fixture.dir, { recursive: true, force: true }))

  const server = await startWebSocketServer(t)
  const connectionPromise = once(server.wss, 'connection')

  const agent = createComponentAgent({
    ipAddress: '127.0.0.1',
    port: server.port,
    directories: [fixture.dir],
    diagnostics: diag,
  })

  const [ws] = await connectionPromise

  const computeSubject = createSubject()
    .env('prod')
    .ns('component-service')
    .context('component-agent')
    .channel('exec')
    .entity('component')
    .action('compute_result')
    .version('v1')
    .build()

  const resultSubject = createSubject()
    .env('prod')
    .ns('component-service')
    .context('component-agent')
    .entity('component')
    .channel('evt')
    .action('result_computed')
    .version('v1')
    .build()

  ws.send(JSON.stringify({
    subject: computeSubject,
    data: {
      instanceId: 'req-1',
      deps: { inputs: { a: 2, b: 3 } },
      componentHash: fixture.hash,
      name: 'add',
      type: 'task',
    },
  }))

  const resultMessage = await waitForMessage(
    server.messages,
    (m) => m.subject === resultSubject,
  )

  assert.ok(resultMessage, 'expected computed result from agent')
  assert.equal(resultMessage.data.instanceId, 'req-1')
  assert.equal(resultMessage.data.name, 'add')
  assert.equal(resultMessage.data.type, 'task')
  assert.equal(resultMessage.data.result, 5)

  agent.removeAllListeners()
  agent.close()
})

test('init_service initializes provided services and stores them', async (t) => {
  const { logger } = createMemoryLogger()
  const diag = diagnostics({ logger, metrics: defaultMetrics })

  const comp = component('svc-comp')
    .service.provide('logger', {
      fnc: ({ deps: { level } }) => ({ level }),
    })
  const componentHash = comp[s.INTERNALS].hash()
  const components = new Map([[componentHash, comp]])

  const published = []
  const router = createExecutionRouter({
    diagnostics: diag,
    publish: (subject, data) => { published.push({ subject, data }) },
  })
  router.context.componentStore.set(components)

  const initSubject = createSubject()
    .env('prod')
    .ns('component-service')
    .context('component-agent')
    .channel('cmd')
    .entity('component')
    .action('init_service')
    .version('v1')
    .build()

  await router.request({
    subject: initSubject,
    message: {
      subject: initSubject,
      data: {
        instanceId: 'svc-1',
        deps: { level: 'debug' },
        componentHash,
        name: 'logger',
        type: 'service',
      },
    },
  })

  const serviceKey = `${componentHash}.service.logger.svc-1`
  assert.deepEqual(router.context.serviceStore.get(serviceKey), { level: 'debug' })

  const resultSubject = createSubject()
    .env('prod')
    .ns('component-service')
    .context('component-agent')
    .entity('component')
    .channel('evt')
    .action('result_computed')
    .version('v1')
    .build()

  assert.equal(published.length, 1)
  assert.equal(published[0].subject, resultSubject)
  assert.deepEqual(published[0].data, {
    instanceId: 'svc-1',
    name: 'logger',
    type: 'service',
    result: true,
  })
})
