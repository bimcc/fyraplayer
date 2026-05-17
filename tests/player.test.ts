import { FyraPlayer } from '../src/player.js';
import { mockTechInstances, resetMockTechInstances } from './mocks/tech-base.js';

(globalThis as any).window = { localStorage: null };

function createVideoStub(): HTMLVideoElement {
  return {
    autoplay: false,
    muted: false,
    preload: 'none',
    src: '',
    srcObject: null,
    load: () => {},
    play: async () => {},
    pause: () => {},
    paused: false,
    currentTime: 0
  } as unknown as HTMLVideoElement;
}

describe('FyraPlayer P0/P1 regressions', () => {
  beforeEach(() => {
    resetMockTechInstances();
  });

  test('applies request + signal middleware returned url to final load source', async () => {
    const player = new FyraPlayer({
      video: createVideoStub(),
      sources: [{ type: 'hls', url: 'https://origin/live.m3u8' }],
      techOrder: ['hls'],
      middleware: [
        {
          kind: 'request',
          fn: () => ({ url: 'https://request/live.m3u8' })
        },
        {
          kind: 'signal',
          fn: (ctx) => ({ url: `${ctx.url}?sig=ok` })
        }
      ]
    });

    await player.init();

    const hlsTech = mockTechInstances.hls[0];
    expect(hlsTech).toBeDefined();
    expect((hlsTech.lastLoadedSource as any).url).toBe('https://request/live.m3u8?sig=ok');

    await player.destroy();
  });

  test('forwards metadata events from tech to player bus', async () => {
    const player = new FyraPlayer({
      video: createVideoStub(),
      sources: [{ type: 'hls', url: 'https://origin/live.m3u8' }],
      techOrder: ['hls']
    });

    const received: any[] = [];
    player.on('metadata', (event) => received.push(event));

    await player.init();

    const hlsTech = mockTechInstances.hls[0];
    hlsTech.emit('metadata', {
      type: 'sei',
      raw: new Uint8Array([1, 2, 3]),
      pts: 123,
      seiType: 5
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: 'sei', pts: 123, seiType: 5 });

    await player.destroy();
  });

  test('normalizes network event code, severity, and message at the player boundary', async () => {
    const player = new FyraPlayer({
      video: createVideoStub(),
      sources: [{ type: 'hls', url: 'https://origin/live.m3u8' }],
      techOrder: ['hls']
    });

    const received: any[] = [];
    player.on('network', (event) => received.push(event));

    await player.init();

    const hlsTech = mockTechInstances.hls[0];
    hlsTech.emit('network', {
      type: 'hls-warning',
      details: 'bufferStalledError',
      severity: 'warning'
    });

    expect(received).toEqual([
      expect.objectContaining({
        type: 'hls-warning',
        code: 'HLS_WARNING',
        severity: 'warning',
        message: 'HLS 警告: bufferStalledError',
        details: 'bufferStalledError'
      })
    ]);

    await player.destroy();
  });

  test('normalizes WebRTC signal-stage network codes without changing the original type', async () => {
    const player = new FyraPlayer({
      video: createVideoStub(),
      sources: [{ type: 'webrtc', url: 'wss://origin/app/stream' }],
      techOrder: ['webrtc']
    });

    const received: any[] = [];
    player.on('network', (event) => received.push(event));

    await player.init();

    const webrtcTech = mockTechInstances.webrtc[0];
    webrtcTech.emit('network', { type: 'ws-open', stage: 'webrtc-signal' });

    expect(received).toEqual([
      expect.objectContaining({
        type: 'ws-open',
        code: 'WEBRTC_SIGNAL_WS_OPEN',
        severity: 'info',
        message: '信令 WebSocket 连接已建立',
        stage: 'webrtc-signal'
      })
    ]);

    await player.destroy();
  });

  test('normalizes qos event code, severity, message, tech, and timestamp', async () => {
    const player = new FyraPlayer({
      video: createVideoStub(),
      sources: [{ type: 'hls', url: 'https://origin/live.m3u8' }],
      techOrder: ['hls']
    });

    const received: any[] = [];
    player.on('qos', (event) => received.push(event));

    await player.init();

    const hlsTech = mockTechInstances.hls[0];
    hlsTech.emit('qos', {
      type: 'webcodecs-ts-warning',
      codec: 'avc1.640028',
      decodedFrames: 12,
      decodeErrors: 2
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(
      expect.objectContaining({
        type: 'webcodecs-ts-warning',
        code: 'WEBCODECS_TS_WARNING',
        severity: 'warning',
        message: 'WebCodecs TS 解码警告: 2 errors, 12 frames',
        tech: 'hls',
        codec: 'avc1.640028',
        decodedFrames: 12,
        decodeErrors: 2
      })
    );
    expect(typeof received[0].ts).toBe('number');

    await player.destroy();
  });

  test('normalizes player-owned reconnect network events', async () => {
    const player = new FyraPlayer({
      video: createVideoStub(),
      sources: [{ type: 'hls', url: 'https://origin/live.m3u8' }],
      techOrder: ['hls'],
      reconnect: { enabled: true, maxRetries: 0 }
    });

    const received: any[] = [];
    player.on('network', (event) => received.push(event));

    try {
      await player.init();

      const hlsTech = mockTechInstances.hls[0];
      hlsTech.emit('network', { type: 'ice-failed', fatal: true });

      expect(received).toEqual([
        expect.objectContaining({
          type: 'ice-failed',
          code: 'WEBRTC_ICE_FAILED',
          severity: 'fatal'
        }),
        expect.objectContaining({
          type: 'reconnect-exhausted',
          code: 'RECONNECT_EXHAUSTED',
          severity: 'fatal',
          message: 'Reconnect attempts exhausted (0/0)'
        })
      ]);
    } finally {
      await player.destroy();
    }
  });

  test('captures ready emitted synchronously during tech load', async () => {
    const player = new FyraPlayer({
      video: createVideoStub(),
      sources: [{ type: 'hls', url: 'https://origin/live.m3u8' }],
      techOrder: ['hls']
    });

    const ready = jest.fn();
    player.on('ready', ready);

    const hlsTech = mockTechInstances.hls[0];
    hlsTech.emitReadyDuringLoad = true;
    await player.init();

    expect(ready).toHaveBeenCalledTimes(1);
    expect(player.getState()).toBe('ready');

    await player.destroy();
  });

  test('exposes currentTime from the bound video element', () => {
    const video = createVideoStub();
    video.currentTime = 12.5;

    const player = new FyraPlayer({
      video,
      sources: [{ type: 'hls', url: 'https://origin/live.m3u8' }],
      techOrder: ['hls']
    });

    expect(player.currentTime).toBe(12.5);
  });

  test('calls plugin destroy on player destroy()', async () => {
    const pluginDestroy = jest.fn();
    const player = new FyraPlayer({
      video: createVideoStub(),
      sources: [{ type: 'hls', url: 'https://origin/live.m3u8' }],
      techOrder: ['hls'],
      plugins: [
        (() => ({ destroy: pluginDestroy })) as any
      ]
    });

    await player.destroy();

    expect(pluginDestroy).toHaveBeenCalledTimes(1);
  });

  test('pause -> play and seek use the active tech without reloading source', async () => {
    const player = new FyraPlayer({
      video: createVideoStub(),
      sources: [{ type: 'hls', url: 'https://origin/live.m3u8' }],
      techOrder: ['hls']
    });

    await player.init();

    const hlsTech = mockTechInstances.hls[0];
    hlsTech.emit('ready');
    hlsTech.emit('play');
    expect(player.getState()).toBe('playing');

    await player.pause();
    expect(hlsTech.pauseCalls).toBe(1);
    expect(player.getState()).toBe('paused');

    await player.play();
    expect(hlsTech.playCalls).toBe(1);

    await player.seek(42.25);
    expect(hlsTech.seekCalls).toBe(1);
    expect(hlsTech.lastSeekTime).toBe(42.25);
    expect(mockTechInstances.hls).toHaveLength(1);

    await player.destroy();
  });

  test('switchSource destroys previous tech and ignores stale events from it', async () => {
    const player = new FyraPlayer({
      video: createVideoStub(),
      sources: [
        { type: 'hls', url: 'https://origin/live.m3u8' },
        { type: 'dash', url: 'https://origin/vod.mpd' }
      ],
      techOrder: ['hls', 'dash']
    });

    const playEvents = jest.fn();
    player.on('play', playEvents);

    await player.init();
    const hlsTech = mockTechInstances.hls[0];
    expect(hlsTech).toBeDefined();

    await player.switchSource(1);

    const dashTech = mockTechInstances.dash[0];
    expect(dashTech).toBeDefined();
    expect(hlsTech.destroyCalls).toBe(1);
    expect(player.getCurrentSource()?.type).toBe('dash');

    hlsTech.emit('play');
    expect(playEvents).not.toHaveBeenCalled();
    expect(player.getState()).toBe('loading');

    dashTech.emit('ready');
    dashTech.emit('play');
    expect(playEvents).toHaveBeenCalledTimes(1);
    expect(player.getState()).toBe('playing');

    await player.destroy();
  });

  test('destroy -> recreate does not duplicate old player event forwarding', async () => {
    const video = createVideoStub();
    const first = new FyraPlayer({
      video,
      sources: [{ type: 'hls', url: 'https://origin/first.m3u8' }],
      techOrder: ['hls']
    });
    const firstPlay = jest.fn();
    first.on('play', firstPlay);
    await first.init();

    const firstTech = mockTechInstances.hls[0];
    await first.destroy();
    firstTech.emit('play');
    expect(firstPlay).not.toHaveBeenCalled();

    const second = new FyraPlayer({
      video,
      sources: [{ type: 'hls', url: 'https://origin/second.m3u8' }],
      techOrder: ['hls']
    });
    const secondPlay = jest.fn();
    second.on('play', secondPlay);
    await second.init();

    const secondTech = mockTechInstances.hls[1];
    secondTech.emit('play');
    expect(firstPlay).not.toHaveBeenCalled();
    expect(secondPlay).toHaveBeenCalledTimes(1);

    await second.destroy();
  });
});
