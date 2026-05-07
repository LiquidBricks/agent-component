import fs from "node:fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import { s } from '@liquid-bricks/lib-component-builder/component/builder/helper';
import { Codes } from './codes.js'


export async function findComponentFiles(rootDir) {
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
  const byHashSource = new Map();
  for (const file of files) {
    const mod = await import(pathToFileURL(file).href);
    diagnostics.require(('default' in mod), Codes.PRECONDITION_REQUIRED, `Flow file ${file} must have a default export (component or array of components)`, { file });
    const def = mod.default;
    const list = Array.isArray(def) ? def : [def];
    diagnostics.require(
      list.every(comp => comp?.[s.IDENTITY.COMPONENT]),
      Codes.PRECONDITION_INVALID,
      `Flow file ${file} default export contains a non-component item`,
      { file }
    );
    for (let exportIndex = 0; exportIndex < list.length; exportIndex++) {
      const comp = list[exportIndex];
      const name = comp[s.INTERNALS].name;
      const h = comp[s.INTERNALS].hash();
      const source = { file, exportIndex, hash: h };
      const existingNameSource = byName.get(name);
      diagnostics.require(
        !existingNameSource,
        Codes.PRECONDITION_INVALID,
        `Duplicate component name detected: "${name}"`,
        {
          name,
          firstFile: existingNameSource?.file,
          duplicateFile: file,
          firstHash: existingNameSource?.hash,
          duplicateHash: h,
          firstExportIndex: existingNameSource?.exportIndex,
          duplicateExportIndex: exportIndex,
        },
      );
      byName.set(name, source);
      const existingHashSource = byHashSource.get(h);
      diagnostics.require(
        !existingHashSource,
        Codes.PRECONDITION_INVALID,
        `Duplicate component hash detected: "${h}"`,
        {
          hash: h,
          firstFile: existingHashSource?.file,
          duplicateFile: file,
          firstComponentName: existingHashSource?.name,
          duplicateComponentName: name,
          firstExportIndex: existingHashSource?.exportIndex,
          duplicateExportIndex: exportIndex,
        },
      );
      byHash.set(h, comp);
      byHashSource.set(h, { ...source, name });
    }
  }
  return byHash
}
