import sources from '../examples/sources.js';

const validTypes = new Set(['webrtc', 'hls', 'dash', 'fmp4', 'ws-raw', 'file', 'gb28181']);
const validTransports = new Set(['flv', 'ts', 'annexb']);
const validCodecs = new Set(['h264', 'h265']);

const failures = [];

function fail(index, message) {
  failures.push(`source[${index}]: ${message}`);
}

sources.forEach((source, index) => {
  if (!source || typeof source !== 'object') {
    fail(index, 'must be an object');
    return;
  }

  if (!validTypes.has(source.type)) {
    fail(index, `invalid type "${source.type}"`);
  }

  if (typeof source.url !== 'string' || source.url.length === 0) {
    fail(index, 'url must be a non-empty string');
  }

  if (source.preferTech && source.preferTech !== source.type) {
    fail(index, `preferTech "${source.preferTech}" does not match type "${source.type}"`);
  }

  if (source.type === 'ws-raw') {
    if (!validCodecs.has(source.codec)) {
      fail(index, 'ws-raw source requires codec h264 or h265');
    }
    if (source.transport && !validTransports.has(source.transport)) {
      fail(index, `invalid ws-raw transport "${source.transport}"`);
    }
  }

  if (source.type === 'fmp4' && !['http', 'ws'].includes(source.transport)) {
    fail(index, 'fmp4 source requires transport http or ws');
  }

  if (source.type === 'file' && source.url.startsWith('blob:') && !source.container) {
    fail(index, 'blob file sources must specify container');
  }
});

if (failures.length) {
  console.error('Invalid example source definitions:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Verified ${sources.length} example sources.`);
