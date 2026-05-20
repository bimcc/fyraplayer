import sources from '../examples/sources.js';

const validTypes = new Set(['webrtc', 'hls', 'dash', 'fmp4', 'ws-raw', 'file', 'gb28181']);
const validTransports = new Set(['flv', 'ts', 'annexb']);
const validCodecs = new Set(['h264', 'h265']);
const validPresentationModes = new Set(['normal', 'panorama']);
const validProjectionModes = new Set(['equirectangular']);

const failures = [];

function fail(index, message) {
  failures.push(`source[${index}]: ${message}`);
}

function validatePresentation(index, presentation, path = 'presentation') {
  if (presentation === undefined) return;
  if (!presentation || typeof presentation !== 'object' || Array.isArray(presentation)) {
    fail(index, `${path} must be an object`);
    return;
  }
  if (presentation.mode !== undefined && !validPresentationModes.has(presentation.mode)) {
    fail(index, `${path}.mode must be normal or panorama`);
  }
  if (presentation.projection !== undefined && !validProjectionModes.has(presentation.projection)) {
    fail(index, `${path}.projection must be equirectangular`);
  }
  if (presentation.textureFlipX !== undefined && typeof presentation.textureFlipX !== 'boolean') {
    fail(index, `${path}.textureFlipX must be boolean`);
  }
  if (presentation.textureFlipY !== undefined && typeof presentation.textureFlipY !== 'boolean') {
    fail(index, `${path}.textureFlipY must be boolean`);
  }
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

  validatePresentation(index, source.presentation);
  validatePresentation(index, source.meta?.presentation, 'meta.presentation');
  if (source.tags !== undefined && (!Array.isArray(source.tags) || source.tags.some((tag) => typeof tag !== 'string'))) {
    fail(index, 'tags must be a string array');
  }
  if (source.meta?.tags !== undefined && (!Array.isArray(source.meta.tags) || source.meta.tags.some((tag) => typeof tag !== 'string'))) {
    fail(index, 'meta.tags must be a string array');
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
