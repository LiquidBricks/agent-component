import test from 'node:test'
import assert from 'node:assert/strict'

import { diagnostics as makeDiagnostics } from '@liquid-bricks/lib-diagnostics'
import { spec as computeResultSpec } from '../../componentAgent/router/routes/compute_result.js'

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
