import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const entry of ['snapshot', 'frame-clock', 'playback-health', 'metadata/index', 'gb-gateway']) {
  const result = await build({ entryPoints: [resolve(root, 'src/plugins', entry + '.ts')],
    bundle: true, write: false, format: 'esm', platform: 'browser', metafile: true, logLevel: 'silent' });
  const inputs = Object.keys(result.metafile.inputs).map(path => path.replaceAll('\\', '/'));
  const leaked = inputs.filter(path => /(?:node_modules|src\/(?:player\.ts|ui\/|techs\/))/.test(path));
  assert.deepEqual(leaked, [], entry + ' must not pull player, UI, Techs or third-party runtimes');
  console.log(entry + ': ' + result.outputFiles[0].contents.length + ' bytes bundled (unminified), no playback/UI/vendor imports');
}
const wt = await build({entryPoints:[resolve(root,'src/plugins/webtransport.ts')],bundle:true,write:false,platform:'browser',format:'esm',metafile:true,logLevel:'silent'});
const wtInputs=Object.keys(wt.metafile.inputs).map(path=>path.replaceAll('\\','/'));
assert.deepEqual(wtInputs.filter(path=>/(node_modules|src\/player\.ts|src\/ui\/|techs\/tech-)/.test(path)),[], 'WebTransport must not pull Player/UI/built-in media Techs/vendors');
console.log('webtransport: '+wt.outputFiles[0].contents.length+' bytes bundled, isolated optional Tech');
