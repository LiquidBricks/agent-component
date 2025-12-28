import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { getComponents } from '../../componentAgent/componentOperations.js'
import { Codes } from '../../componentAgent/codes.js'
import { diagnostics } from '@liquid-bricks/lib-diagnostics'
import { s } from '@liquid-bricks/lib-component-builder/component/builder/helper'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const builderImportPath = '@liquid-bricks/lib-component-builder/component/builder'
const helpImportPath = '@liquid-bricks/lib-component-builder/component/builder/helper'

const defaultMetrics = { count() { }, timing() { } }
function createMemoryLogger() {
  const entries = []
  const logger = {}
  for (const level of ['info', 'warn', 'error', 'debug']) {
    logger[level] = (entry) => entries.push({ level, ...entry })
  }
  return { logger, entries }
}

async function writeModule({ dir, fileName, sourceLines }) {
  await fs.mkdir(dir, { recursive: true })
  const filePath = path.join(dir, fileName)
  await fs.writeFile(filePath, sourceLines.join('\n'), 'utf8')
  return filePath
}

function createDiagnostics() {
  const { logger } = createMemoryLogger()
  return diagnostics({ logger, metrics: defaultMetrics })
}

test('getComponents loads components and indexes them by hash', async (t) => {
  const diag = createDiagnostics()
  const tmpRoot = await fs.mkdtemp(path.join(__dirname, 'tmp-getcomponents-success-'))
  t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }))

  const nestedDir = path.join(tmpRoot, 'nested')

  const alphaPath = await writeModule({
    dir: tmpRoot,
    fileName: 'alpha.comp.js',
    sourceLines: [
      `import { component } from '${builderImportPath}';`,
      `const comp = component('alpha').task('noop', { fnc: () => 'alpha' });`,
      'export default comp;',
      '',
    ],
  })
  const listPath = await writeModule({
    dir: nestedDir,
    fileName: 'beta.comp.js',
    sourceLines: [
      `import { component } from '${builderImportPath}';`,
      `const beta = component('beta');`,
      `const gamma = component('gamma').data('value', { fnc: () => 3 });`,
      'export default [beta, gamma];',
      '',
    ],
  })

  const alphaMod = await import(pathToFileURL(alphaPath).href)
  const listMod = await import(pathToFileURL(listPath).href)

  const components = await getComponents([tmpRoot], diag)

  const expected = [alphaMod.default, ...listMod.default]
  assert.equal(components.size, expected.length)
  for (const comp of expected) {
    const hash = comp[s.INTERNALS].hash()
    assert.equal(typeof hash, 'string')
    assert.equal(components.get(hash), comp)
  }
})

test('getComponents requires a default export', async (t) => {
  const diag = createDiagnostics()
  const tmpRoot = await fs.mkdtemp(path.join(__dirname, 'tmp-getcomponents-no-default-'))
  t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }))

  await writeModule({
    dir: tmpRoot,
    fileName: 'missing.comp.js',
    sourceLines: [
      'export const value = 1;',
      '',
    ],
  })

  await assert.rejects(
    () => getComponents([tmpRoot], diag),
    (err) => err.code === Codes.PRECONDITION_REQUIRED && /default export/.test(err.message)
  )
})

test('getComponents rejects non-component exports', async (t) => {
  const diag = createDiagnostics()
  const tmpRoot = await fs.mkdtemp(path.join(__dirname, 'tmp-getcomponents-invalid-'))
  t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }))

  await writeModule({
    dir: tmpRoot,
    fileName: 'invalid.comp.js',
    sourceLines: [
      'export default [{ notAComponent: true }];',
      '',
    ],
  })

  await assert.rejects(
    () => getComponents([tmpRoot], diag),
    (err) => err.code === Codes.PRECONDITION_INVALID && /non-component item/i.test(err.message)
  )
})

test('getComponents rejects duplicate component hashes', async (t) => {
  const diag = createDiagnostics()
  const tmpRoot = await fs.mkdtemp(path.join(__dirname, 'tmp-getcomponents-duplicate-hash-'))
  t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }))

  await writeModule({
    dir: tmpRoot,
    fileName: 'dupe.comp.js',
    sourceLines: [
      `import { s } from '${helpImportPath}';`,
      'const make = (name) => ({',
      '  [s.IDENTITY.COMPONENT]: true,',
      '  [s.INTERNALS]: {',
      '    name,',
      "    hash: () => 'fixed-hash',",
      '  },',
      '});',
      "export default [make('first'), make('second')];",
      '',
    ],
  })

  await assert.rejects(
    () => getComponents([tmpRoot], diag),
    (err) => err.code === Codes.PRECONDITION_INVALID && /Duplicate component hash/i.test(err.message)
  )
})
