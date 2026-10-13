import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
// Under the repository so optional build-time dependencies resolve from its node_modules.
// The player itself is unpacked from the tarball: no source aliases or workspace link.
const parent = join(root, '.fyra-long-run');
mkdirSync(parent, { recursive: true });
const temp = mkdtempSync(join(parent, 'package-consumer-'));
const npmCandidates = [
  process.env.npm_execpath,
  join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
  resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')
].filter(p => p && p.endsWith('npm-cli.js') && existsSync(p));
try {
  if (!npmCandidates.length) throw new Error('npm CLI not found next to Node; install the standard Node distribution.');
  const archive = process.argv[2] ? resolve(process.argv[2]) : join(temp, JSON.parse(execFileSync(process.execPath, [npmCandidates[0], 'pack', '--json', '--ignore-scripts', '--pack-destination', temp], { cwd: root, encoding: 'utf8' }))[0].filename);
  // Validate paths before extraction, including archives supplied for final candidate checks.
  const names=execFileSync('tar',['-tf',archive],{encoding:'utf8'}).trim().split(/\r?\n/);
  if(names.some(name=>!name.startsWith('package/') || name.includes('\\') || name.split('/').includes('..')))throw new Error('Unsafe package paths');
  const installed = join(temp, 'node_modules', pkg.name);
  mkdirSync(installed, { recursive: true });
  execFileSync('tar', ['-xf', archive, '-C', installed, '--strip-components=1']);
  const allowed = /^(dist\/|package\.json$|README\.md$|CHANGELOG\.md$|RELEASE_NOTES\.md$|THIRD_PARTY_NOTICES\.md$|LICENSE$)/;
  const files=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(join(dir,entry.name)):[join(dir,entry.name)]);
  for(const file of files(installed))if(!allowed.test(file.slice(installed.length+1).replaceAll('\\','/')))throw new Error('Unexpected packaged file: '+file);
  const packed=JSON.parse(readFileSync(join(installed,'package.json'),'utf8'));
  if(packed.version!==pkg.version || packed.name!==pkg.name || JSON.stringify(packed.exports)!==JSON.stringify(pkg.exports))throw new Error('Candidate metadata differs from workspace');
  for (const file of ['LICENSE', 'RELEASE_NOTES.md', 'THIRD_PARTY_NOTICES.md', 'dist/fyraplayer.iife.js', 'dist/vendor/dash.all.min.js', 'dist/vendor/dash.all.min.js.LICENSE.txt', 'dist/licenses/dashjs-LICENSE.md', 'dist/licenses/hls.js-NOTICE.txt', 'dist/licenses/Apache-2.0.txt']) {
    if (!existsSync(join(installed, file))) throw new Error('Missing tarball file: ' + file);
  }
  const entries = Object.entries(pkg.exports).filter(([, value]) => typeof value === 'object').map(([key]) => key === '.' ? pkg.name : pkg.name + key.slice(1));
  const imports = entries.map((entry, i) => 'import * as entry' + i + ' from ' + JSON.stringify(entry) + ';\nvoid entry' + i + ';').join('\n');
  writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(join(temp, 'consumer.ts'), imports + '\n' + [
    'import { FyraPlayer, type MetadataEvent } from "' + pkg.name + '";',
    'import { MetadataBridge, KlvBridge } from "' + pkg.name + '/plugins/metadata";',
    'const metadata: MetadataEvent = { type: "private-data", raw: new Uint8Array(), pts: 0, pts90k: 0n };',
    'void new MetadataBridge({parse: event => event.pts90k, onData: () => {}}).handle(metadata);',
    'const alias: typeof MetadataBridge = KlvBridge; void alias;',
    'const player = new FyraPlayer({video: document.createElement("video"), sources: [], loadTimeoutMs: 15000});',
    'player.on("sessionchange", event => { event.epoch.toFixed(); event.session?.source.url.toString(); });',
    'player.getPlaybackSession()?.status.toString();',
    'player.on("sourcechange", event => { event.index.toFixed(); });',
    'player.on("seek", event => { event.time.toFixed(); });',
    'void player.destroy();',
    'import { createSnapshotPlugin } from "' + pkg.name + '/plugins/snapshot";',
    'import { createFrameClockPlugin, mediaTimeToPts90k } from "' + pkg.name + '/plugins/frame-clock";',
    'import { createPlaybackHealthPlugin } from "' + pkg.name + '/plugins/playback-health";',
    'createPlaybackHealthPlugin({frameSource:"external",onHandle:handle=>{handle.reportFrame({mediaTime:1,sessionEpoch:1});handle.snapshot().precision.toString();handle.setSuspended(false);}});',
    'createSnapshotPlugin({ onHandle: handle => { void handle.capture({maxWidth: 640}); } });',
    'createFrameClockPlugin({ onFrame: sample => { mediaTimeToPts90k(sample.mediaTime, {mediaTime: 0, pts90k: 0n}); } });',
    'import { createGbGatewayAdapter } from "' + pkg.name + '/plugins/gb-gateway";',
    'import { createWebTransportTechPlugin, encodeTransportMetadata, transportTimestampToPts90k, type WebTransportSource } from "' + pkg.name + '/plugins/webtransport";',
    'const wt: WebTransportSource = {type:"webtransport",url:"https://example.com/video",fallbacks:[{type:"file",url:"/video.mp4"}]};',
    'const gateway=createGbGatewayAdapter({invite:async (_source,signal)=>{signal.throwIfAborted();return {id:"1",source:wt};}});',
    'void new FyraPlayer({video:document.createElement("video"),sources:[wt],middleware:[gateway.middleware],plugins:[gateway.plugin,createWebTransportTechPlugin({onFrame:(_frame,info)=>{info.timestamp.toFixed();info.timelineId.toFixed();},onHandle:handle=>{handle.getLatestFrame();}})]});',
    'encodeTransportMetadata({type:"private-data",timestamp:5000017,identifier:300,data:new Uint8Array([2,8])});transportTimestampToPts90k(5000017);',
    'const raw:import("'+pkg.name+'").MetadataEvent={type:"private-data",raw:new Uint8Array([2,8]),pts:5000.017,timestampUs:5000017};void raw;'
  ].join('\n'));
  for (const module of ['NodeNext', 'ESNext']) {
    writeFileSync(join(temp, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'ES2020', module, moduleResolution: module === 'NodeNext' ? 'NodeNext' : 'Bundler', strict: true, noEmit: true, skipLibCheck: false, types: [], lib: ['ES2020', 'DOM', 'DOM.Iterable'] },
      files: ['consumer.ts']
    }));
    execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', join(temp, 'tsconfig.json')], { cwd: temp, stdio: 'pipe' });
  }
  writeFileSync(join(temp, 'runtime.mjs'), entries.map(entry => 'await import(' + JSON.stringify(entry) + ');').join('\n'));
  execFileSync(process.execPath, [join(temp, 'runtime.mjs')], { cwd: temp, stdio: 'pipe' });
  const bundled = await build({ entryPoints: [join(temp, 'consumer.ts')], bundle: true, write: false, platform: 'browser', format: 'esm', logLevel: 'silent' });
  if (!bundled.outputFiles[0]?.contents.length) throw new Error('Browser bundle was empty');
  console.log('Packaged consumer: ' + entries.length + ' public JS/type entries, NodeNext + Bundler declarations, runtime imports and browser bundle passed.');
} catch (error) {
  if (error.stdout) console.error(error.stdout.toString());
  if (error.stderr) console.error(error.stderr.toString());
  throw error;
} finally {
  const resolved = resolve(temp);
  if (!resolved.startsWith(resolve(parent) + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('Unsafe temporary path');
  rmSync(resolved, { recursive: true, force: true });
}
