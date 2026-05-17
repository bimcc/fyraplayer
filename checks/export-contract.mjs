import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

const paths = new Set();

function addPath(value) {
  if (typeof value === 'string' && value.startsWith('./')) {
    paths.add(value);
  }
}

function collectExportPaths(value) {
  if (typeof value === 'string') {
    addPath(value);
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  for (const child of Object.values(value)) {
    collectExportPaths(child);
  }
}

addPath(pkg.main);
addPath(pkg.module);
addPath(pkg.types);
collectExportPaths(pkg.exports);

const missing = [];
for (const packagePath of paths) {
  const diskPath = resolve(root, packagePath);
  if (!existsSync(diskPath)) {
    missing.push(packagePath);
  }
}

if (missing.length) {
  console.error('Missing package export files:');
  for (const packagePath of missing) {
    console.error(`- ${packagePath}`);
  }
  process.exit(1);
}

console.log(`Verified ${paths.size} package export files.`);
