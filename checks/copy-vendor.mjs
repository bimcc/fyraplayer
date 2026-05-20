import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = resolve(root, 'dist/vendor');

mkdirSync(vendorDir, { recursive: true });

copyFileSync(
  resolve(root, 'node_modules/dashjs/dist/modern/umd/dash.all.min.js'),
  resolve(vendorDir, 'dash.all.min.js')
);
