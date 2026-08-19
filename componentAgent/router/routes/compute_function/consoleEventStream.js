import { AsyncLocalStorage } from 'node:async_hooks'

const consoleEventContext = new AsyncLocalStorage()
const hostConsole = globalThis.console
const ignoredConsoleProperties = new Set(['Console', 'constructor'])

installConsoleRedirect()

export function runWithConsoleEventStream({ emit, execute }) {
  const execution = {
    active: true,
    emit: typeof emit === 'function' ? emit : () => {},
  }

  return consoleEventContext.run(execution, async () => {
    try {
      return await execute()
    } finally {
      execution.active = false
    }
  })
}

function installConsoleRedirect() {
  for (const [method, original] of consoleMethods(hostConsole)) {
    const descriptor = findPropertyDescriptor(hostConsole, method)

    try {
      Object.defineProperty(hostConsole, method, {
        configurable: descriptor?.configurable ?? true,
        enumerable: descriptor?.enumerable ?? true,
        writable: descriptor?.writable ?? true,
        value: function redirectedConsoleMethod(...args) {
          const execution = consoleEventContext.getStore()
          if (!execution) return Reflect.apply(original, hostConsole, args)
          if (!execution.active) return undefined

          consoleEventContext.exit(() => emitConsoleEvent(execution.emit, method, args))
          return undefined
        },
      })
    } catch {
      // A non-configurable host method cannot be redirected. Standard console
      // methods are configurable in supported Node runtimes.
    }
  }
}

function consoleMethods(consoleObject) {
  const methods = new Map()

  for (let current = consoleObject; current && current !== Object.prototype; current = Object.getPrototypeOf(current)) {
    for (const property of Object.getOwnPropertyNames(current)) {
      if (ignoredConsoleProperties.has(property) || methods.has(property)) continue

      const descriptor = Object.getOwnPropertyDescriptor(current, property)
      if (typeof descriptor?.value === 'function') methods.set(property, descriptor.value)
    }
  }

  return methods
}

function findPropertyDescriptor(value, property) {
  for (let current = value; current; current = Object.getPrototypeOf(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, property)
    if (descriptor) return descriptor
  }
}

function emitConsoleEvent(emit, method, args) {
  try {
    const publication = emit({ method, args })
    if (publication && typeof publication.then === 'function') {
      Promise.resolve(publication).catch(() => {})
    }
  } catch {
    // Console transport is best effort and must not alter function execution.
  }
}
