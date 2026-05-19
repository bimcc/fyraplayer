// Example sources derived from testmedia.md
export default [
  // === HLS 测试流 ===
  { type: 'hls', url: 'https://sf1-cdn-tos.huoshanstatic.com/obj/media-fe/xgplayer_doc_video/hls/xgplayer-demo.m3u8', lowLatency: false, preferTech: 'hls' },
  { type: 'hls', url: 'https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8', preferTech: 'hls' },
  { type: 'hls', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', preferTech: 'hls' },
  // HLS with fMP4/CMAF segments. This is still played through the HLS Tech, not the direct fMP4 Tech.
  { type: 'hls', url: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8', preferTech: 'hls' },
  { type: 'hls', url: 'http://127.0.0.1:8888/live/test/index.m3u8', lowLatency: false, preferTech: 'hls' },
  { type: 'hls', url: 'http://127.0.0.1:8888/live/test/index.m3u8', lowLatency: true, preferTech: 'hls' },
  { type: 'webrtc', url: 'http://127.0.0.1:8889/live/test/whep', preferTech: 'webrtc' },

  // === Direct fMP4 测试流（无 m3u8/mpd 清单，走 FMP4Tech + MSE）===
  { type: 'fmp4', url: '/ffmpeg-fmp4/stream.fmp4', transport: 'http', codec: 'h264', audioCodec: 'aac', videoCodecString: 'avc1.4d401f', audioCodecString: 'mp4a.40.2', isLive: true, preferTech: 'fmp4' },
  
  // === DASH 测试流 ===
  { type: 'dash', url: 'https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd', preferTech: 'dash' },
  { type: 'dash', url: 'https://bitmovin-a.akamaihd.net/content/sintel/sintel.mpd', preferTech: 'dash' },
  
  // === 全景视频测试流 (360°) ===
  { type: 'hls', url: 'https://cdn.bitmovin.com/content/assets/playhouse-vr/m3u8s/105560.m3u8', preferTech: 'hls', panorama: true },
  { type: 'dash', url: 'https://cdn.bitmovin.com/content/assets/playhouse-vr/mpds/105560.mpd', preferTech: 'dash', panorama: true },
  { type: 'file', url: 'https://cdn.bitmovin.com/content/assets/playhouse-vr/progressive.mp4', panorama: true },
  
  // === MP4 文件 ===
  { type: 'file', url: 'https://sf1-cdn-tos.huoshanstatic.com/obj/media-fe/xgplayer_doc_video/mp4/xgplayer-demo-360p.mp4' },
  { type: 'file', url: 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/1080/Big_Buck_Bunny_1080_10s_30MB.mp4' },
  
  // === 本地测试视频（Vite root 在 examples 下，直接访问 /testvideo/*）===
  { type: 'file', url: '/testvideo/DJI_20250611085647_0001_V.TS', webCodecs: { enable: true } },
  { type: 'file', url: '/testvideo/Rec%200017.mp4', webCodecs: { enable: true } },
  
  // === FLV 测试流 ===
  { type: 'ws-raw', url: 'https://sf1-cdn-tos.huoshanstatic.com/obj/media-fe/xgplayer_doc_video/flv/xgplayer-demo-360p.flv', codec: 'h264', transport: 'flv', preferTech: 'ws-raw' }
];
