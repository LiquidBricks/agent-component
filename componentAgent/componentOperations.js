import fs from "node:fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import { s } from '@liquid-bricks/lib-component-builder/component/builder/helper';
import { Codes } from './codes.js'


async function findComponentFiles(rootDir) {
  const files = [];

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.comp.js')) continue;

      files.push(full);
    }
  }

  await walk(rootDir);
  return files;
}

export async function getComponents(directories, diagnostics) {
  const files = await Promise.all(directories.map(findComponentFiles))
    .then(fileGroups => fileGroups.flat());

  const byName = new Map();
  const byHash = new Map();
  for (const file of files) {
    const mod = await import(pathToFileURL(file).href);
    diagnostics.require(('default' in mod), Codes.PRECONDITION_REQUIRED, `Flow file ${file} must have a default export (component or array of components)`, { file });
    const def = mod.default;
    const list = Array.isArray(def) ? def : [def];
    for (const comp of list) {
      diagnostics.require(comp?.[s.IDENTITY.COMPONENT], Codes.PRECONDITION_INVALID, `Flow file ${file} default export contains a non-component item`, { file });
      const name = comp[s.INTERNALS].name;
      diagnostics.require(!byName.has(name), Codes.PRECONDITION_INVALID, `Duplicate component name detected: "${name}"`, { name });
      byName.set(name, comp);
      const h = comp[s.INTERNALS].hash();
      diagnostics.require(!byHash.has(h), Codes.PRECONDITION_INVALID, `Duplicate component hash detected: "${h}"`, { hash: h });
      byHash.set(h, comp);
    }
  }
  return byHash
}
