import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = resolve(root, 'dist/vendor');
const licenseDir = resolve(root, 'dist/licenses');

mkdirSync(vendorDir, { recursive: true });
mkdirSync(licenseDir, { recursive: true });

copyFileSync(
  resolve(root, 'node_modules/dashjs/dist/modern/umd/dash.all.min.js'),
  resolve(vendorDir, 'dash.all.min.js')
);
for (const [source, target] of [
  ['node_modules/dashjs/LICENSE.md', 'dashjs-LICENSE.md'],
  ['node_modules/hls.js/LICENSE', 'hls.js-NOTICE.txt'],
  ['licenses/Apache-2.0.txt', 'Apache-2.0.txt']
]) copyFileSync(resolve(root, source), resolve(licenseDir, target));
copyFileSync(
  resolve(root, 'node_modules/dashjs/dist/modern/umd/dash.all.min.js.LICENSE.txt'),
  resolve(vendorDir, 'dash.all.min.js.LICENSE.txt')
);
