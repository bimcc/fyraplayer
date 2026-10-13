import assert from 'node:assert/strict';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Optional cross-repository check; no fyraklv runtime dependency is added to the SDK.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = resolve(process.argv[2] ?? join(root, '../fyraklv'));
const { KLVStreamManager } = await import(pathToFileURL(join(project, 'dist/index.js')).href);
const compiled = await build({stdin:{contents:
  `export {createFyraKlvPlugin} from ${JSON.stringify(join(root,'examples/integrations/fyraklv.ts'))};
   export {TransportVideoParser,encodeTransportConfig,encodeTransportMetadata,transportTimestampToPts90k} from ${JSON.stringify(join(root,'src/plugins/webtransport/protocol.ts'))};`,
  resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node'});
const { createFyraKlvPlugin, TransportVideoParser, encodeTransportConfig, encodeTransportMetadata, transportTimestampToPts90k } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].contents).toString('base64'));
const handlers = new Map();
const service = new KLVStreamManager();
let handle;
let displayedMediaTime = null;
const controller = new AbortController();
let session = { epoch: 1, tech: 'file', status: 'loaded', requestedSource: {type:'file',url:'requested.ts'}, source: {type:'file',url:'fixture.ts'} };
let resets = 0;
const player = {
  currentTime: 1,
  getCurrentSource: () => ({ type: 'file', url: 'fixture.ts' }),
  getPlaybackSession: () => session,
  on: (name, handler) => handlers.set(name, handler),
  off: (name, handler) => { if (handlers.get(name) === handler) handlers.delete(name); }
};
const plugin = createFyraKlvPlugin({
  createService: () => service,
  getMediaTime: () => displayedMediaTime,
  onTimelineReset: () => { resets++; },
  mediaTimeToPts: seconds => 900000n + BigInt(Math.round(seconds * 90000)),
  onHandle: value => { handle = value; }
})({ player, lifecycle: { signal: controller.signal, onCleanup() {} } });
const raw = new Uint8Array([2,8,0,0,0,0,0,0,3,232,13,4,0,0,0,0,14,4,0,0,0,0]);
handlers.get('metadata')({ type: 'private-data', raw, pts: 11000, pts90k: 990000n });
assert.equal(service.getBufferInfo().firstPts, 990000n);
assert.equal(handle.getState(), null, 'No frame clock sample must not query with currentTime');
displayedMediaTime = 1;
assert.equal(handle.getState()?.latitude, 0);
assert.equal(handle.getState()?.longitude, 0);
session = { ...session, epoch: 2 };
handlers.get('sessionchange')({ epoch: 2, reason: 'discontinuity', session });
assert.equal(resets, 1);
handlers.get('sessionchange')({ epoch: 2, reason: 'loaded', session });
assert.equal(resets, 1, 'Load completion must not reset an unchanged epoch');
assert.equal(service.getBufferInfo().count, 0);
assert.equal(handle.getState(), null);
controller.abort();
assert.equal(handle.getStateAtPts(990000n), null, 'Aborted handles must stop querying immediately');
handlers.get('metadata')({ type: 'private-data', raw, pts: 11000, pts90k: 990000n });
assert.equal(service.getBufferInfo().count, 0, 'Abort must stop ingestion before final cleanup');
plugin.destroy();
assert.equal(handlers.size, 0);
assert.equal(handle.getStateAtPts(990000n), null);
const transportService=new KLVStreamManager();
session={...session,epoch:3,tech:'webtransport',source:{type:'webtransport',url:'https://localhost/metadata'}};
const transportPlugin=createFyraKlvPlugin({createService:()=>transportService,mediaTimeToPts:()=>null,onHandle:value=>{handle=value;}})({player});
const parser=new TransportVideoParser();
Array.from(parser.push(encodeTransportConfig({codec:'avc1.42C00C',codedWidth:320,codedHeight:200})));
for (const timestamp of [5000017,100000000000000]) {
  session={...session,epoch:session.epoch+1};
  handlers.get('sessionchange')({epoch:session.epoch,reason:'discontinuity',session});
  for(const packet of parser.push(encodeTransportMetadata({type:'private-data',timestamp,identifier:300,data:raw}))) {
    handlers.get('metadata')({type:packet.type,raw:packet.data,pts:packet.timestamp/1000,timestampUs:packet.timestamp,pid:packet.identifier});
  }
  const pts=transportTimestampToPts90k(timestamp);
  assert.equal(transportService.getBufferInfo().firstPts,pts,'WebTransport ingestion must use exact original microseconds, without a 33-bit mask');
  assert.equal(handle.getStateAtPts(pts)?.latitude,0);
  assert.equal(handle.getStateAtPts(pts)?.timestamp,Number(pts));
}
transportPlugin.destroy();assert.equal(handlers.size,0);
console.log('fyraklv KLVStreamManager: real TS/WebTransport parsing, exact original clock including >33-bit values, session reset, immediate abort and teardown passed.');
