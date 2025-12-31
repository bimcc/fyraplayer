// Example sources derived from testmedia.md
export default [
  { type: 'hls', url: 'https://sf1-cdn-tos.huoshanstatic.com/obj/media-fe/xgplayer_doc_video/hls/xgplayer-demo.m3u8', lowLatency: false, preferTech: 'hlsdash' },
  { type: 'dash', url: 'https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd', preferTech: 'hlsdash' },
  { type: 'dash', url: 'https://bitmovin-a.akamaihd.net/content/sintel/sintel.mpd', preferTech: 'hlsdash' },
  { type: 'file', url: 'https://sf1-cdn-tos.huoshanstatic.com/obj/media-fe/xgplayer_doc_video/mp4/xgplayer-demo-360p.mp4' },
  // 本地测试视频（Vite root 在 examples 下，直接访问 /testvideo/*）
  { type: 'file', url: '/testvideo/DJI_20250611085647_0001_V.TS', webCodecs: { enable: true } },
  { type: 'file', url: '/testvideo/Rec%200017.mp4', webCodecs: { enable: true } },
  { type: 'ws-raw', url: 'https://sf1-cdn-tos.huoshanstatic.com/obj/media-fe/xgplayer_doc_video/flv/xgplayer-demo-360p.flv', codec: 'h264', transport: 'flv', preferTech: 'ws-raw' }
];
