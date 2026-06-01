export interface BrowserManagedCodecSupport {
  mediaSource: {
    available: boolean;
    h264: boolean;
    h265: boolean;
    h264MimeTypes: string[];
    h265MimeTypes: string[];
  };
  nativeVideo: {
    available: boolean;
    hls: boolean;
    mp4H264: boolean;
    mp4H265: boolean;
    h265MimeTypes: string[];
  };
}

export const H264_BROWSER_MANAGED_CODECS = [
  'avc1.64001f',
  'avc1.42E01E',
  'avc1.4D401E'
];

export const H265_BROWSER_MANAGED_CODECS = [
  'hvc1.1.6.L93.B0',
  'hev1.1.6.L93.B0',
  'hvc1.2.4.L123.B0',
  'hev1.2.4.L123.B0'
];

export interface BrowserManagedMp4MimeOptions {
  codec?: 'h264' | 'h265' | 'av1';
  videoCodecString?: string;
  audioCodec?: 'aac' | 'opus' | 'mp3';
  audioCodecString?: string;
}

export interface MimeSelection {
  mimeType: string | null;
  unsupported: string[];
}

function getMediaSourceCtor(): typeof MediaSource | undefined {
  const mediaSource = (globalThis as typeof globalThis & { MediaSource?: typeof MediaSource }).MediaSource;
  return mediaSource && typeof mediaSource.isTypeSupported === 'function' ? mediaSource : undefined;
}

function getVideoProbeElement(): HTMLVideoElement | null {
  const doc = (globalThis as typeof globalThis & { document?: Document }).document;
  if (!doc?.createElement) return null;
  return doc.createElement('video');
}

function canPlay(video: HTMLVideoElement | null, mimeType: string): boolean {
  if (!video || typeof video.canPlayType !== 'function') return false;
  const result = video.canPlayType(mimeType);
  return result === 'probably' || result === 'maybe';
}

export function isH265CodecString(codec: string | null | undefined): boolean {
  if (!codec) return false;
  const normalized = codec.trim().toLowerCase();
  return normalized.startsWith('hvc1') || normalized.startsWith('hev1');
}

export function buildMp4MimeType(videoCodec: string, audioCodec = 'mp4a.40.2'): string {
  return `video/mp4; codecs="${videoCodec},${audioCodec}"`;
}

export function buildBrowserManagedMp4MimeCandidates(options: BrowserManagedMp4MimeOptions): string[] {
  const videoCodecs = options.videoCodecString
    ? [options.videoCodecString]
    : options.codec === 'h265'
      ? H265_BROWSER_MANAGED_CODECS
      : options.codec === 'av1'
        ? ['av01.0.04M.08']
        : H264_BROWSER_MANAGED_CODECS;

  const audioCodec = options.audioCodecString
    || (options.audioCodec === 'opus'
      ? 'opus'
      : options.audioCodec === 'mp3'
        ? 'mp3'
        : 'mp4a.40.2');

  return videoCodecs.map((videoCodec) => buildMp4MimeType(videoCodec, audioCodec));
}

export function isMediaSourceMimeTypeSupported(mimeType: string): boolean {
  const mediaSource = getMediaSourceCtor();
  if (!mediaSource) return false;
  try {
    return mediaSource.isTypeSupported(mimeType);
  } catch {
    return false;
  }
}

export function selectSupportedMediaSourceMime(candidates: string[]): MimeSelection {
  const unsupported: string[] = [];
  for (const mimeType of candidates) {
    if (isMediaSourceMimeTypeSupported(mimeType)) {
      return { mimeType, unsupported };
    }
    unsupported.push(mimeType);
  }
  return { mimeType: null, unsupported };
}

export function probeBrowserManagedCodecs(): BrowserManagedCodecSupport {
  const h264MimeTypes = H264_BROWSER_MANAGED_CODECS.map((codec) => buildMp4MimeType(codec));
  const h265MimeTypes = H265_BROWSER_MANAGED_CODECS.map((codec) => buildMp4MimeType(codec));
  const supportedH264Mse = h264MimeTypes.filter(isMediaSourceMimeTypeSupported);
  const supportedH265Mse = h265MimeTypes.filter(isMediaSourceMimeTypeSupported);
  const video = getVideoProbeElement();
  const nativeH265 = h265MimeTypes.filter((mimeType) => canPlay(video, mimeType));

  return {
    mediaSource: {
      available: !!getMediaSourceCtor(),
      h264: supportedH264Mse.length > 0,
      h265: supportedH265Mse.length > 0,
      h264MimeTypes: supportedH264Mse,
      h265MimeTypes: supportedH265Mse
    },
    nativeVideo: {
      available: !!video,
      hls: canPlay(video, 'application/vnd.apple.mpegurl'),
      mp4H264: h264MimeTypes.some((mimeType) => canPlay(video, mimeType)),
      mp4H265: nativeH265.length > 0,
      h265MimeTypes: nativeH265
    }
  };
}
