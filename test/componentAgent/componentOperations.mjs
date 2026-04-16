import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { findComponentFiles, getComponents } from '../../componentAgent/componentOperations.js'
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

test('findComponentFiles returns .comp.js files from nested directories', async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(__dirname, 'tmp-findfiles-success-'))
  t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }))

  const nestedDir = path.join(tmpRoot, 'level-one')
  const deeperDir = path.join(nestedDir, 'level-two')
  await fs.mkdir(deeperDir, { recursive: true })

  const rootFile = path.join(tmpRoot, 'root.comp.js')
  const childFile = path.join(nestedDir, 'child.comp.js')
  const deepFile = path.join(deeperDir, 'deep.comp.js')

  await Promise.all([
    fs.writeFile(rootFile, '// root component\n', 'utf8'),
    fs.writeFile(childFile, '// child component\n', 'utf8'),
    fs.writeFile(deepFile, '// deep component\n', 'utf8'),
    fs.writeFile(path.join(tmpRoot, 'ignore.txt'), 'do not include\n', 'utf8'),
    fs.writeFile(path.join(nestedDir, 'ignore.other'), 'still ignore\n', 'utf8'),
  ])

  const files = await findComponentFiles(tmpRoot)
  const expected = [rootFile, childFile, deepFile]
  const sortedFiles = [...files].sort()
  const sortedExpected = expected.slice().sort()
  assert.deepStrictEqual(sortedFiles, sortedExpected)
})

test('findComponentFiles returns empty array when no matching files exist', async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(__dirname, 'tmp-findfiles-empty-'))
  t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }))

  await fs.mkdir(path.join(tmpRoot, 'nested'), { recursive: true })
  await fs.writeFile(path.join(tmpRoot, 'nested', 'ignore.js'), 'noop\n', 'utf8')
  await fs.writeFile(path.join(tmpRoot, 'not-a-comp.txt'), 'noop\n', 'utf8')

  const files = await findComponentFiles(tmpRoot)
  assert.deepStrictEqual(files, [])
})

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

test('getComponents handles default export arrays with multiple components', async (t) => {
  const diag = createDiagnostics()
  const tmpRoot = await fs.mkdtemp(path.join(__dirname, 'tmp-getcomponents-array-default-'))
  t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }))

  const multiPath = await writeModule({
    dir: tmpRoot,
    fileName: 'multi.comp.js',
    sourceLines: [
      `import { component } from '${builderImportPath}';`,
      `const one = component('one').task('noop', { fnc: () => 'one' });`,
      `const two = component('two').data('value', { fnc: () => 2 });`,
      `const three = component('three');`,
      'export default [one, two, three];',
      '',
    ],
  })

  const expectedComponents = (await import(pathToFileURL(multiPath).href)).default
  const components = await getComponents([tmpRoot], diag)

  assert.equal(components.size, expectedComponents.length)
  for (const comp of expectedComponents) {
    const hash = comp[s.INTERNALS].hash()
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
