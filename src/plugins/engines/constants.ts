export const DEFAULT_ENGINE_CONFIGS = {
  zlm: {
    httpPort: 8081,
    useHttps: true,
    webrtcPath: '/index/api/webrtc?app={app}&stream={stream}&type=play',
    flvPath: '/{app}/{stream}.live.flv',
    mp4Path: '/{app}/{stream}.live.mp4',
    hlsPath: '/{app}/{stream}/hls.m3u8',
    fallbackChain: ['webrtc', 'http-flv', 'ws-flv', 'll-hls', 'hls']
  },
  monibuca: {
    httpPort: 8081,
    useHttps: true,
    webrtcPath: '/webrtc/play/{fullPath}',
    flvPath: '/flv/{fullPath}.flv',
    mp4Path: '/fmp4/{fullPath}.fmp4',
    hlsPath: '/hls/{fullPath}.m3u8',
    fallbackChain: ['webrtc', 'http-flv', 'ws-flv', 'hls']
  },
  srs: {
    httpPort: 8080,
    useHttps: false,
    webrtcPath: '/rtc/v1/play/',
    flvPath: '{path}.flv',
    mp4Path: '{path}.mp4',
    hlsPath: '{path}.m3u8',
    fallbackChain: ['webrtc', 'http-flv', 'hls']
  },
  oven: {
    httpPort: 3333,
    wsPort: 3333,
    useHttps: false,
    webrtcPath: '/{fullPath}',  // WebSocket signaling path for WebRTC
    llHlsPath: '/{fullPath}/llhls.m3u8',
    dashPath: '/{fullPath}/manifest.mpd',
    fallbackChain: ['webrtc', 'll-hls']
  },
  mediamtx: {
    webrtcPort: 8889,
    hlsPort: 8888,
    useHttps: false,
    webrtcPath: '{path}/whep',
    hlsPath: '{path}/index.m3u8',
    fallbackChain: ['webrtc', 'll-hls', 'hls']
  },
  tencent: {
    useHttps: true,
    playDomain: '',
    webrtcPath: '/{app}/{stream}',
    flvPath: '/{app}/{stream}.flv',
    hlsPath: '/{app}/{stream}.m3u8',
    fallbackChain: ['webrtc', 'http-flv', 'hls']
  }
};

export function getFallbackChain(engine: string): string[] {
  return DEFAULT_ENGINE_CONFIGS[engine as keyof typeof DEFAULT_ENGINE_CONFIGS]?.fallbackChain || [];
}
