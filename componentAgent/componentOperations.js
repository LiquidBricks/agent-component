import fs from "node:fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import { s } from '@liquid-bricks/lib-component-builder/component/builder/helper';
import { Codes } from './codes.js'


async function findFilesBySuffix(rootDir, suffix) {
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
      if (!entry.name.endsWith(suffix)) continue;

      files.push(full);
    }
  }

  await walk(rootDir);
  return files;
}

export async function findComponentFiles(rootDir) {
  return findFilesBySuffix(rootDir, '.comp.js');
}

export async function findAgentFnFiles(rootDir) {
  return findFilesBySuffix(rootDir, '.agentFn.js');
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

export async function getAgentFns(directories, diagnostics) {
  const files = await Promise.all(directories.map(findAgentFnFiles))
    .then(fileGroups => fileGroups.flat());

  const byPortAddr = new Map();
  const byPortAddrSource = new Map();
  for (const file of files) {
    const mod = await import(pathToFileURL(file).href);
    const exports = collectAgentFnExports(mod);
    diagnostics.require(
      exports.length > 0,
      Codes.PRECONDITION_REQUIRED,
      `Agent function file ${file} must export an agentFn or array of agentFns`,
      { file },
    );

    for (const { value, exportName, exportIndex } of exports) {
      const normalized = normalizeAgentFn(value);
      diagnostics.require(
        normalized,
        Codes.PRECONDITION_INVALID,
        `Agent function file ${file} export contains a non-agentFn item`,
        { file, exportName, exportIndex },
      );

      const { portAddr, hash, fn } = normalized;
      const source = { file, exportName, exportIndex, portAddr, hash };
      const existingSource = byPortAddrSource.get(portAddr);
      diagnostics.require(
        !existingSource,
        Codes.PRECONDITION_INVALID,
        `Duplicate agentFn portAddr detected: "${portAddr}"`,
        {
          portAddr,
          firstFile: existingSource?.file,
          duplicateFile: file,
          firstHash: existingSource?.hash,
          duplicateHash: hash,
          firstExportName: existingSource?.exportName,
          duplicateExportName: exportName,
          firstExportIndex: existingSource?.exportIndex,
          duplicateExportIndex: exportIndex,
        },
      );

      byPortAddr.set(portAddr, { portAddr, hash, fn });
      byPortAddrSource.set(portAddr, source);
    }
  }
  return byPortAddr;
}

function collectAgentFnExports(mod) {
  const exports = [];

  if ('default' in mod) {
    const list = Array.isArray(mod.default) ? mod.default : [mod.default];
    for (let exportIndex = 0; exportIndex < list.length; exportIndex++) {
      exports.push({ value: list[exportIndex], exportName: 'default', exportIndex });
    }
    return exports;
  }

  for (const [exportName, value] of Object.entries(mod)) {
    if (Array.isArray(value)) {
      for (let exportIndex = 0; exportIndex < value.length; exportIndex++) {
        exports.push({ value: value[exportIndex], exportName, exportIndex });
      }
    } else {
      exports.push({ value, exportName, exportIndex: 0 });
    }
  }

  return exports;
}

function normalizeAgentFn(value) {
  const internal = value?.[s.INTERNALS];
  const candidate = internal ?? value;
  const portAddr = candidate?.portAddr ?? value?.portAddr;
  const fn = candidate?.fn ?? value?.fn;
  const hashSource = candidate?.hash ?? value?.hash;
  const hash = typeof hashSource === 'function' ? hashSource.call(candidate) : hashSource;

  if (typeof portAddr !== 'string' || !portAddr.trim() || typeof fn !== 'function') {
    return null;
  }

  return {
    portAddr: portAddr.trim(),
    hash: typeof hash === 'string' && hash.trim() ? hash.trim() : undefined,
    fn,
  };
}
