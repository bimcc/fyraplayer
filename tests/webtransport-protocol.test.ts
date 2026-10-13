import {TransportVideoParser,encodeTransportConfig,encodeTransportChunk,encodeTransportMetadata,transportTimestampToPts90k,MAX_METADATA_BYTES} from '../src/plugins/webtransport/protocol.js';
const config={codec:'avc1.42E01E',codedWidth:320,codedHeight:200};
const concat=(...parts:Uint8Array[])=>{const data=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const part of parts){data.set(part,offset);offset+=part.length;}return data;};
describe('WebTransport reliable video framing',()=>{
  test('transports optional interleaved raw metadata with independent monotonic clocks',()=>{
    const metadata=encodeTransportMetadata({type:'private-data',timestamp:5000017,identifier:256,data:new Uint8Array([6,14,43,52])});
    const input=concat(encodeTransportConfig(config),metadata,encodeTransportChunk({key:true,timestamp:5000000,data:new Uint8Array([1])}),
      encodeTransportMetadata({type:'sei',timestamp:4999999,identifier:5,data:new Uint8Array([9])}));
    for(let split=0;split<=input.length;split++) {
      const parser=new TransportVideoParser();
      const packets=[...parser.push(input.subarray(0,split)),...parser.push(input.subarray(split))];
      expect(packets[1]).toMatchObject({kind:'metadata',type:'private-data',identifier:256,timestamp:5000017,data:new Uint8Array([6,14,43,52])});
      expect(packets[3]).toMatchObject({kind:'metadata',type:'sei',identifier:5,timestamp:4999999});parser.finish();
    }
  });
  test('rejects unknown record kinds instead of interpreting them as video or metadata',()=>{
    const record=encodeTransportMetadata({type:'sei',timestamp:0,data:new Uint8Array([9])});
    record[4]=4;
    expect(()=>[...new TransportVideoParser().push(concat(encodeTransportConfig(config),record))]).toThrow('Unknown');
  });
  test('rejects unconfigured, oversized, malformed and regressing metadata; new config resets clocks',()=>{
    const parser=new TransportVideoParser();
    const packet=(timestamp:number)=>encodeTransportMetadata({type:'private-data',timestamp,data:new Uint8Array([1])});
    expect(()=>[...parser.push(packet(12))]).toThrow('missing config');
    [...parser.push(encodeTransportConfig(config))];[...parser.push(packet(12))];
    expect(()=>[...parser.push(packet(10))]).toThrow('timestamps');
    [...parser.push(encodeTransportConfig(config))];expect([...parser.push(packet(0))][0]).not.toHaveProperty('identifier');
    expect(()=>encodeTransportMetadata({type:'private-data',timestamp:0,identifier:8192,data:new Uint8Array([1])})).toThrow();
    expect(()=>encodeTransportMetadata({type:'sei',timestamp:0,data:new Uint8Array(MAX_METADATA_BYTES+1)})).toThrow();
    const invalid=packet(0);invalid[5]=3;
    expect(()=>[...parser.push(invalid)]).toThrow('Invalid metadata');
    const oversized=new Uint8Array(5);new DataView(oversized.buffer).setUint32(0,MAX_METADATA_BYTES+15);oversized[4]=3;
    expect(()=>[...parser.push(oversized)]).toThrow('Metadata packet exceeds');
  });
  test('transport PTS conversion rounds exactly without multiplying large floats or masking TS wrap',()=>{
    expect(transportTimestampToPts90k(5000017)).toBe(450002n);
    const max=Number.MAX_SAFE_INTEGER;
    expect(transportTimestampToPts90k(max)).toBe((BigInt(max)*9n+50n)/100n);
    expect(transportTimestampToPts90k(100000000000)).toBe(9000000000n);
    for(const invalid of [-1,NaN,0.1,max+1])expect(()=>transportTimestampToPts90k(invalid)).toThrow();
  });
  test('handles every possible split and subarray byte offsets without altering payloads',()=>{
    const input=concat(encodeTransportConfig(config),encodeTransportChunk({key:true,timestamp:9000000,duration:40000,data:new Uint8Array([1,2,3])}));
    for(let split=0;split<=input.length;split++){
      const parser=new TransportVideoParser();
      const padded=concat(new Uint8Array([99,99]),input,new Uint8Array([99]));
      const packets=[...parser.push(padded.subarray(2,split+2)),...parser.push(padded.subarray(split+2,padded.length-1))];
      expect(packets).toHaveLength(2);
      expect(packets[1]).toMatchObject({kind:'video',key:true,timestamp:9000000,duration:40000,data:new Uint8Array([1,2,3])});
      parser.finish();
    }
  });
  test('rejects unbounded allocation, invalid configs and missing codec setup',()=>{
    const prefix=new Uint8Array(4);new DataView(prefix.buffer).setUint32(0,0xffffffff);
    expect(()=>[...new TransportVideoParser().push(prefix)]).toThrow('limits');
    expect(()=>encodeTransportConfig({...config,codedWidth:999999})).toThrow();
    expect(()=>encodeTransportConfig({...config,description:[256]})).toThrow();
    expect(()=>[...new TransportVideoParser().push(encodeTransportChunk({key:true,timestamp:0,data:new Uint8Array([1])}))]).toThrow('missing config');
  });
  test('detects truncated frames and timestamp regression; config establishes a new timeline',()=>{
    const parser=new TransportVideoParser();[...parser.push(encodeTransportConfig(config))];
    [...parser.push(encodeTransportChunk({key:true,timestamp:12,data:new Uint8Array([1])}))];
    expect(()=>[...parser.push(encodeTransportChunk({key:false,timestamp:10,data:new Uint8Array([2])}))]).toThrow('timestamps');
    [...parser.push(encodeTransportConfig(config))];
    expect([...parser.push(encodeTransportChunk({key:true,timestamp:0,data:new Uint8Array([1])}))]).toHaveLength(1);
    [...parser.push(new Uint8Array([0,0]))];expect(()=>parser.finish()).toThrow('Truncated');
  });
});
