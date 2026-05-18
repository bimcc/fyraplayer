import { DASHTech } from '../src/techs/tech-dash.js';
import { HLSTech } from '../src/techs/tech-hls.js';

type Handler = (...args: unknown[]) => void;

const HLS_EVENTS = {
  ERROR: 'hlsError',
  LEVEL_SWITCHED: 'hlsLevelSwitched',
  MANIFEST_PARSED: 'hlsManifestParsed',
  FRAG_BUFFERED: 'hlsFragBuffered'
};

const HLS_ERROR_DETAILS = {
  BUFFER_STALLED_ERROR: 'bufferStalledError',
  MANIFEST_LOAD_ERROR: 'manifestLoadError'
};

const HLS_ERROR_TYPES = {
  MEDIA_ERROR: 'mediaError',
  NETWORK_ERROR: 'networkError'
};

const DASH_EVENTS = {
  ERROR: 'dashError',
  QUALITY_CHANGE_RENDERED: 'dashQualityChangeRendered',
  CAN_PLAY: 'dashCanPlay',
  PLAYBACK_METADATA_LOADED: 'dashPlaybackMetadataLoaded'
};

jest.mock('hls.js', () => {
  class HlsMock {}
  Object.assign(HlsMock, {
    Events: {
      ERROR: 'hlsError',
      LEVEL_SWITCHED: 'hlsLevelSwitched',
      MANIFEST_PARSED: 'hlsManifestParsed',
      FRAG_BUFFERED: 'hlsFragBuffered'
    },
    ErrorDetails: {
      BUFFER_STALLED_ERROR: 'bufferStalledError',
      MANIFEST_LOAD_ERROR: 'manifestLoadError'
    },
    ErrorTypes: {
      MEDIA_ERROR: 'mediaError',
      NETWORK_ERROR: 'networkError'
    },
    isSupported: () => true
  });
  return {
    __esModule: true,
    default: HlsMock
  };
});

jest.mock('dashjs', () => ({
  __esModule: true,
  MediaPlayer: {
    events: {
      ERROR: 'dashError',
      QUALITY_CHANGE_RENDERED: 'dashQualityChangeRendered',
      CAN_PLAY: 'dashCanPlay',
      PLAYBACK_METADATA_LOADED: 'dashPlaybackMetadataLoaded'
    }
  }
}));

class FakeHls {
  public handlers = new Map<string, Handler>();
  public autoLevelCapping = -1;
  public recovered = 0;
  public startLoadCalls = 0;
  public stopLoadCalls = 0;
  public detachMediaCalls = 0;
  public destroyCalls = 0;
  public currentLevel = 1;
  public autoLevelEnabled = true;
  public levels = [
    { bitrate: 800000, width: 640, height: 360, videoCodec: 'avc1.42e01e' },
    { bitrate: 2500000, width: 1280, height: 720, videoCodec: 'avc1.4d401f' }
  ];

  on(event: string, handler: Handler): void {
    this.handlers.set(event, handler);
  }

  off(event: string): void {
    this.handlers.delete(event);
  }

  stopLoad(): void {
    this.stopLoadCalls += 1;
  }

  detachMedia(): void {
    this.detachMediaCalls += 1;
  }

  destroy(): void {
    this.destroyCalls += 1;
  }

  recoverMediaError(): void {
    this.recovered += 1;
  }

  startLoad(): void {
    this.startLoadCalls += 1;
  }
}

class FakeDash {
  public handlers = new Map<string, Handler>();
  public settings: any = { streaming: { abr: { autoSwitchBitrate: { video: true } } } };
  public representationIndex: number | null = null;
  public representations = [
    { absoluteIndex: 0, index: 0, bandwidth: 800000, bitrateInKbit: 800, width: 640, height: 360, codecs: 'avc1.42e01e', id: 'r0' },
    { absoluteIndex: 1, index: 1, bandwidth: 2500000, bitrateInKbit: 2500, width: 1280, height: 720, codecs: 'avc1.4d401f', id: 'r1' }
  ];

  on(event: string, handler: Handler): void {
    this.handlers.set(event, handler);
  }

  off(event: string): void {
    this.handlers.delete(event);
  }

  reset(): void {}

  getSettings(): any {
    return this.settings;
  }

  updateSettings(settings: any): void {
    this.settings = {
      ...this.settings,
      streaming: {
        ...this.settings.streaming,
        ...settings.streaming,
        abr: {
          ...this.settings.streaming?.abr,
          ...settings.streaming?.abr,
          autoSwitchBitrate: {
            ...this.settings.streaming?.abr?.autoSwitchBitrate,
            ...settings.streaming?.abr?.autoSwitchBitrate
          }
        }
      }
    };
  }

  getRepresentationsByType(): any[] {
    return this.representations;
  }

  getCurrentRepresentationForType(): any {
    return this.representations[this.representationIndex ?? 0];
  }

  setRepresentationForTypeByIndex(_type: string, index: number): void {
    this.representationIndex = index;
  }
}

function createVideoStub(): HTMLVideoElement {
  const handlers = new Map<string, EventListenerOrEventListenerObject>();
  return {
    src: '',
    srcObject: null,
    onloadedmetadata: null,
    onloadeddata: null,
    oncanplay: null,
    onerror: null,
    videoWidth: 1280,
    videoHeight: 720,
    clientHeight: 360,
    currentTime: 0,
    addEventListener: (event: string, handler: EventListenerOrEventListenerObject) => {
      handlers.set(event, handler);
    },
    removeEventListener: (event: string) => {
      handlers.delete(event);
    },
    pause: () => {},
    removeAttribute: () => {},
    load: () => {},
    dispatchEvent: (event: Event) => {
      const handler = handlers.get(event.type);
      if (typeof handler === 'function') {
        handler(event);
      } else if (handler && typeof handler.handleEvent === 'function') {
        handler.handleEvent(event);
      }
      return true;
    }
  } as unknown as HTMLVideoElement;
}

describe('HLS and DASH event semantics', () => {
  beforeEach(() => {
    (globalThis as unknown as { window: { innerHeight: number } }).window = { innerHeight: 720 };
  });

  test('HLS maps non-fatal errors to network warnings without player error', () => {
    const tech = new HLSTech();
    const fakeHls = new FakeHls();
    (tech as unknown as { hls: FakeHls }).hls = fakeHls;
    (tech as unknown as { setupHlsEventHandlers(video: HTMLVideoElement): void }).setupHlsEventHandlers(createVideoStub());

    const errors: unknown[] = [];
    const network: unknown[] = [];
    const buffers: unknown[] = [];
    tech.on('error', (event) => errors.push(event));
    tech.on('network', (event) => network.push(event));
    tech.on('buffer', (event) => buffers.push(event));

    fakeHls.handlers.get(HLS_EVENTS.ERROR)?.('hlsError', {
      type: HLS_ERROR_TYPES.MEDIA_ERROR,
      details: HLS_ERROR_DETAILS.BUFFER_STALLED_ERROR,
      fatal: false
    });

    expect(errors).toHaveLength(0);
    expect(buffers).toHaveLength(1);
    expect(network).toEqual([
      {
        type: 'hls-warning',
        details: HLS_ERROR_DETAILS.BUFFER_STALLED_ERROR,
        hlsType: HLS_ERROR_TYPES.MEDIA_ERROR,
        severity: 'warning'
      }
    ]);
  });

  test('HLS maps fatal media errors to error and media recovery attempt', () => {
    const tech = new HLSTech();
    const fakeHls = new FakeHls();
    (tech as unknown as { hls: FakeHls }).hls = fakeHls;
    (tech as unknown as { setupHlsEventHandlers(video: HTMLVideoElement): void }).setupHlsEventHandlers(createVideoStub());

    const errors: unknown[] = [];
    const network: unknown[] = [];
    tech.on('error', (event) => errors.push(event));
    tech.on('network', (event) => network.push(event));

    const fatalPayload = {
      type: HLS_ERROR_TYPES.MEDIA_ERROR,
      details: HLS_ERROR_DETAILS.MANIFEST_LOAD_ERROR,
      fatal: true
    };
    fakeHls.handlers.get(HLS_EVENTS.ERROR)?.('hlsError', fatalPayload);

    expect(errors).toEqual([fatalPayload]);
    expect(network).toEqual([
      { type: 'hls-fatal', details: HLS_ERROR_DETAILS.MANIFEST_LOAD_ERROR, fatal: true }
    ]);
    expect(fakeHls.recovered).toBe(1);
    expect(fakeHls.startLoadCalls).toBe(0);
  });

  test('HLS maps fatal network errors to error and load restart attempt', () => {
    const tech = new HLSTech();
    const fakeHls = new FakeHls();
    (tech as unknown as { hls: FakeHls }).hls = fakeHls;
    (tech as unknown as { setupHlsEventHandlers(video: HTMLVideoElement): void }).setupHlsEventHandlers(createVideoStub());

    const errors: unknown[] = [];
    const network: unknown[] = [];
    tech.on('error', (event) => errors.push(event));
    tech.on('network', (event) => network.push(event));

    const fatalPayload = {
      type: HLS_ERROR_TYPES.NETWORK_ERROR,
      details: HLS_ERROR_DETAILS.MANIFEST_LOAD_ERROR,
      fatal: true
    };
    fakeHls.handlers.get(HLS_EVENTS.ERROR)?.('hlsError', fatalPayload);

    expect(errors).toEqual([fatalPayload]);
    expect(network).toEqual([
      { type: 'hls-fatal', details: HLS_ERROR_DETAILS.MANIFEST_LOAD_ERROR, fatal: true }
    ]);
    expect(fakeHls.recovered).toBe(0);
    expect(fakeHls.startLoadCalls).toBe(1);
  });

  test('HLS emits stable levelSwitch and ready payloads', () => {
    const tech = new HLSTech();
    const fakeHls = new FakeHls();
    (tech as unknown as { hls: FakeHls }).hls = fakeHls;
    (tech as unknown as { setupHlsEventHandlers(video: HTMLVideoElement): void }).setupHlsEventHandlers(createVideoStub());

    const ready = jest.fn();
    const levelSwitches: unknown[] = [];
    tech.on('ready', ready);
    tech.on('levelSwitch', (event) => levelSwitches.push(event));

    fakeHls.handlers.get(HLS_EVENTS.MANIFEST_PARSED)?.('manifestParsed', {});
    fakeHls.handlers.get(HLS_EVENTS.LEVEL_SWITCHED)?.('levelSwitched', { level: 1 });
    fakeHls.handlers.get(HLS_EVENTS.FRAG_BUFFERED)?.('fragBuffered', {});
    fakeHls.handlers.get(HLS_EVENTS.FRAG_BUFFERED)?.('fragBuffered', {});

    expect(fakeHls.autoLevelCapping).toBe(1);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(levelSwitches).toEqual([
      {
        tech: 'hls',
        to: 1,
        bitrateKbps: 2500,
        width: 1280,
        height: 720,
        codec: 'avc1.4d401f'
      }
    ]);
  });

  test('HLS exposes quality levels and supports manual and auto selection', async () => {
    const tech = new HLSTech();
    const fakeHls = new FakeHls();
    fakeHls.autoLevelEnabled = false;
    (tech as unknown as { hls: FakeHls }).hls = fakeHls;

    expect(tech.getQualityState()).toMatchObject({
      supported: true,
      tech: 'hls',
      auto: false,
      current: 1,
      levels: [
        { id: 0, index: 0, label: '360p 800 kbps', bitrateKbps: 800, width: 640, height: 360, codec: 'avc1.42e01e', active: false },
        { id: 1, index: 1, label: '720p 2500 kbps', bitrateKbps: 2500, width: 1280, height: 720, codec: 'avc1.4d401f', active: true }
      ]
    });

    await tech.setQualityLevel(0);
    expect(fakeHls.currentLevel).toBe(0);

    await tech.setQualityLevel('auto');
    expect(fakeHls.currentLevel).toBe(-1);

    await expect(tech.setQualityLevel(9)).rejects.toThrow('Invalid HLS quality level');
  });

  test('HLS destroy stops loading and fully detaches the media element', async () => {
    const tech = new HLSTech();
    const fakeHls = new FakeHls();
    const pause = jest.fn();
    const load = jest.fn();
    const removeAttribute = jest.fn();
    const video = {
      ...createVideoStub(),
      pause,
      load,
      removeAttribute,
      srcObject: {} as MediaStream,
      onloadedmetadata: jest.fn(),
      onloadeddata: jest.fn(),
      oncanplay: jest.fn(),
      onerror: jest.fn(),
    } as unknown as HTMLVideoElement;

    (tech as unknown as { video: HTMLVideoElement }).video = video;
    (tech as unknown as { hls: FakeHls }).hls = fakeHls;
    (tech as unknown as { setupHlsEventHandlers(video: HTMLVideoElement): void }).setupHlsEventHandlers(video);

    await tech.destroy();

    expect(fakeHls.handlers.size).toBe(0);
    expect(fakeHls.stopLoadCalls).toBe(1);
    expect(fakeHls.detachMediaCalls).toBe(1);
    expect(fakeHls.destroyCalls).toBe(1);
    expect(video.onloadedmetadata).toBeNull();
    expect(video.onloadeddata).toBeNull();
    expect(video.oncanplay).toBeNull();
    expect(video.onerror).toBeNull();
    expect(video.srcObject).toBeNull();
    expect(pause).toHaveBeenCalledTimes(1);
    expect(removeAttribute).toHaveBeenCalledWith('src');
    expect(load).toHaveBeenCalledTimes(1);
  });

  test('DASH maps fatal and non-fatal errors deterministically', () => {
    const tech = new DASHTech();
    const fakeDash = new FakeDash();
    (tech as unknown as { dash: FakeDash }).dash = fakeDash;
    (tech as unknown as { setupDashEventHandlers(video: HTMLVideoElement): void }).setupDashEventHandlers(createVideoStub());

    const errors: unknown[] = [];
    const network: unknown[] = [];
    tech.on('error', (event) => errors.push(event));
    tech.on('network', (event) => network.push(event));

    const warningPayload = { error: 'download', event: { severity: 'warning' } };
    const fatalPayload = { error: 'capability', event: { severity: 'fatal' } };
    fakeDash.handlers.get(DASH_EVENTS.ERROR)?.(warningPayload);
    fakeDash.handlers.get(DASH_EVENTS.ERROR)?.(fatalPayload);

    expect(network).toEqual([{ type: 'dash-error', details: warningPayload }]);
    expect(errors).toEqual([fatalPayload]);
  });

  test('DASH emits stable levelSwitch payload and ready only once', () => {
    const tech = new DASHTech();
    const fakeDash = new FakeDash();
    const video = createVideoStub();
    (tech as unknown as { dash: FakeDash }).dash = fakeDash;
    (tech as unknown as { setupDashEventHandlers(video: HTMLVideoElement): void }).setupDashEventHandlers(video);

    const ready = jest.fn();
    const levelSwitches: unknown[] = [];
    tech.on('ready', ready);
    tech.on('levelSwitch', (event) => levelSwitches.push(event));

    fakeDash.handlers.get(DASH_EVENTS.CAN_PLAY)?.({});
    video.dispatchEvent(new Event('loadedmetadata'));
    fakeDash.handlers.get(DASH_EVENTS.QUALITY_CHANGE_RENDERED)?.({
      mediaType: 'video',
      oldQuality: 0,
      newQuality: 2,
      oldRepresentation: { absoluteIndex: 0, bandwidth: 800000, width: 640, height: 360 },
      newRepresentation: {
        absoluteIndex: 2,
        bandwidth: 3200000,
        width: 1920,
        height: 1080,
        codecs: 'avc1.640028'
      },
      reason: 'abr'
    });

    expect(ready).toHaveBeenCalledTimes(1);
    expect(levelSwitches).toEqual([
      {
        tech: 'dash',
        mediaType: 'video',
        from: 0,
        to: 2,
        bitrateKbps: 3200,
        width: 1920,
        height: 1080,
        codec: 'avc1.640028',
        reason: 'abr'
      }
    ]);
  });

  test('DASH exposes quality levels and supports manual and auto selection', async () => {
    const tech = new DASHTech();
    const fakeDash = new FakeDash();
    fakeDash.settings.streaming.abr.autoSwitchBitrate.video = false;
    fakeDash.representationIndex = 1;
    (tech as unknown as { dash: FakeDash }).dash = fakeDash;

    expect(tech.getQualityState()).toMatchObject({
      supported: true,
      tech: 'dash',
      auto: false,
      current: 1,
      levels: [
        { id: 0, index: 0, label: '360p 800 kbps', bitrateKbps: 800, width: 640, height: 360, codec: 'avc1.42e01e', active: false },
        { id: 1, index: 1, label: '720p 2500 kbps', bitrateKbps: 2500, width: 1280, height: 720, codec: 'avc1.4d401f', active: true }
      ]
    });

    await tech.setQualityLevel(0);
    expect(fakeDash.settings.streaming.abr.autoSwitchBitrate.video).toBe(false);
    expect(fakeDash.representationIndex).toBe(0);

    await tech.setQualityLevel('r1');
    expect(fakeDash.representationIndex).toBe(1);

    await tech.setQualityLevel('auto');
    expect(fakeDash.settings.streaming.abr.autoSwitchBitrate.video).toBe(true);

    await expect(tech.setQualityLevel(9)).rejects.toThrow('Invalid DASH quality level');
  });
});
