import { Demuxer } from '../src/techs/wsRaw/demuxer.js';
import { processSeiNalu } from '../src/techs/wsRaw/demuxer/sei.js';

// Deterministic wire fixtures, no codec/network mocks or external media files.
function pes(data: Uint8Array, pts: bigint) {
  const size=data.length+8;
  return Uint8Array.from([0,0,1,0xbd,size>>8,size&255,0x80,0x80,5,
    0x21|Number((pts>>29n)&14n),Number((pts>>22n)&255n),Number((pts>>14n)&254n)|1,
    Number((pts>>7n)&255n),Number((pts<<1n)&254n)|1,...data]);
}
function packet(payload: Uint8Array, start: boolean, counter=0) {
  const p=new Uint8Array(188).fill(255), padding=184-payload.length;
  p.set([0x47,(start?0x40:0)|1,0,(padding?0x30:0x10)|counter]);
  if(padding) {p[4]=padding-1;if(padding>1)p[5]=0;}
  p.set(payload,188-payload.length); return p;
}

test('TS private PES spanning network chunks is emitted once with exact 33-bit PTS', () => {
  const received=jest.fn(), bytes=Uint8Array.from({length:260},(_,i)=>i%256), pts=(1n<<32n)+12345n;
  const demux=new Demuxer({format:'ts',privateDataPids:[256],callbacks:{onPrivateData:received}});
  const data=pes(bytes,pts), a=packet(data.subarray(0,184),true), b=packet(data.subarray(184),false,1);
  demux.demux(a.slice(0,97).buffer); expect(received).not.toHaveBeenCalled();
  demux.demux(a.slice(97).buffer); expect(received).not.toHaveBeenCalled();
  demux.demux(b.buffer);
  expect(received).toHaveBeenCalledTimes(1);
  expect(received).toHaveBeenCalledWith(256,bytes,Math.round(Number(pts)/90),pts);
});

test('TS truncated PES is discarded at the next start and detect-only extraction can be enabled', () => {
  const received=jest.fn();
  const demux=new Demuxer({format:'ts',privateDataPids:[256],privateDataDetectOnly:true,callbacks:{onPrivateData:received}});
  demux.demux(packet(pes(new Uint8Array([1,2]),90000n),true).buffer);
  expect(received).not.toHaveBeenCalled(); demux.enableExtraction();
  demux.demux(packet(pes(new Uint8Array(260),90000n).subarray(0,184),true).buffer);
  demux.demux(packet(pes(new Uint8Array([7,8]),180001n),true).buffer);
  expect(received).toHaveBeenCalledTimes(1);
  expect(received.mock.calls[0][1]).toEqual(new Uint8Array([7,8]));
  expect(received.mock.calls[0][3]).toBe(180001n);
});

test('FLV video tags split at arbitrary bytes retain frame and timestamp', () => {
  const body=[0x17,1,0,0,0,0,0,0,2,0x65,0x88];
  const bytes=Uint8Array.from([0x46,0x4c,0x56,1,1,0,0,0,9,0,0,0,0,
    9,0,0,body.length,0,0,42,0,0,0,0,...body,0,0,0,body.length+11]);
  const demux=new Demuxer('flv'), frames=[];
  for(let i=0;i<bytes.length;i+=7) frames.push(...demux.demux(bytes.slice(i,i+7).buffer));
  expect(frames).toEqual([{pts:42,isKey:true,track:'video',data:new Uint8Array([0,0,0,1,0x65,0x88])}]);
});

test('empty bounded PES is not treated as unbounded transport padding', () => {
  const received = jest.fn();
  const demux = new Demuxer({ format: 'ts', privateDataPids: [256], callbacks: { onPrivateData: received } });
  const padded = new Uint8Array(184).fill(255);
  padded.set(pes(new Uint8Array(), 90000n));
  demux.demux(packet(padded, true).buffer);
  demux.demux(packet(pes(new Uint8Array([7]), 180000n), true).buffer);
  expect(received).toHaveBeenCalledTimes(1);
  expect(received.mock.calls[0][1]).toEqual(new Uint8Array([7]));
});

test('SEI extracts a complete payload and ignores a truncated message', () => {
  const onSEI=jest.fn(),state={detectedSeiTypes:new Set<number>(),seiDetectOnly:false,extractionEnabled:true};
  processSeiNalu(new Uint8Array([6,5,3,9,8,7,0x80]),123,{onSEI},state);
  processSeiNalu(new Uint8Array([6,5,8,9]),124,{onSEI},state);
  expect(onSEI).toHaveBeenCalledTimes(1);
  expect(onSEI).toHaveBeenCalledWith(new Uint8Array([9,8,7]),123,5);
});
