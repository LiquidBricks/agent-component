import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// Resolve package root URL from this test file location
const pkgRoot = new URL('../', import.meta.url)

// Load and parse package.json
const pkgJsonUrl = new URL('package.json', pkgRoot)
const pkg = JSON.parse(fs.readFileSync(pkgJsonUrl, 'utf8'))

const { name: pkgName, exports: exportMap } = pkg

// Lock the public API surface: enumerate expected subpath exports
const expectedExportKeys = [
  '.',
  './component/agent',
  './router',
  './codes',
]

test('exports keys match expected API surface', () => {
  assert.ok(exportMap && typeof exportMap === 'object', 'exports map missing')
  const actual = Object.keys(exportMap).sort()
  const expected = expectedExportKeys.slice().sort()
  assert.deepEqual(actual, expected, 'package.json exports keys changed; update expectedExportKeys if intentional')
})

test('all expected exports resolve and match target files', async () => {
  assert.ok(pkgName && typeof pkgName === 'string', 'package name missing')
  assert.ok(exportMap && typeof exportMap === 'object', 'exports map missing')

  await Promise.all(expectedExportKeys.map(async (subpath) => {
    const target = exportMap[subpath]
    assert.ok(target, `missing mapping for ${subpath}`)

    const targetUrl = new URL(target, pkgRoot)
    assert.ok(fs.existsSync(targetUrl), `target missing for ${subpath}: ${target}`)

    const spec = pkgName + subpath.slice(1) // remove leading '.'

    const [viaExport, viaPath] = await Promise.all([
      import(spec),
      import(targetUrl.href),
    ])

    assert.strictEqual(viaExport, viaPath, `mismatch for ${spec} -> ${target}`)
    assert.ok(Object.keys(viaExport).length > 0, `no exports found for ${spec}`)
  }))
})
