import { Gb28181Tech } from '../src/techs/tech-gb28181.js';
import type { Gb28181Source } from '../src/types.js';

const mseStartMock = jest.fn();
const mseStopMock = jest.fn();

jest.mock('../src/techs/wsRaw/mseFallback.js', () => ({
  MseFallback: jest.fn().mockImplementation(() => ({
    start: mseStartMock,
    stop: mseStopMock
  }))
}));

function createVideoStub(): HTMLVideoElement {
  return {
    play: async () => {},
    pause: () => {},
    srcObject: null,
    src: ''
  } as unknown as HTMLVideoElement;
}

function createSource(): Gb28181Source {
  return {
    type: 'gb28181',
    url: '',
    control: {
      invite: 'https://api.example.com/invite',
      bye: 'https://api.example.com/bye',
      ptz: 'https://api.example.com/ptz',
      query: 'https://api.example.com/query',
      keepalive: 'https://api.example.com/keepalive'
    },
    gb: {
      deviceId: 'dev-1',
      channelId: 'ch-1'
    },
    responseMapping: {
      url: 'play_urls.ws_flv',
      callId: 'stream_id',
      streamId: 'stream_id'
    },
    format: 'flv'
  };
}

describe('Gb28181Tech gateway adapter contract', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    mseStartMock.mockClear();
    mseStopMock.mockClear();
    fetchMock.mockReset();
    (globalThis as any).fetch = fetchMock;
  });

  test('invite supports responseMapping dot-path and starts standard MSE playback', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        stream_id: 'stream-123',
        play_urls: { ws_flv: 'wss://media.example.com/live.flv' },
        ssrc: '001122'
      })
    });

    const tech = new Gb28181Tech();
    await tech.load(createSource(), {
      video: createVideoStub()
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [inviteUrl, inviteOptions] = fetchMock.mock.calls[0];
    expect(inviteUrl).toBe('https://api.example.com/invite');
    expect(inviteOptions.method).toBe('POST');
    const inviteBody = JSON.parse(inviteOptions.body as string);
    expect(inviteBody).toMatchObject({
      deviceId: 'dev-1',
      channelId: 'ch-1'
    });

    expect(mseStartMock).toHaveBeenCalledTimes(1);
    expect(mseStartMock.mock.calls[0][0]).toBe('wss://media.example.com/live.flv');
    expect(mseStartMock.mock.calls[0][3]).toBe('flv');
  });

  test('invite includes gb stream_mode and control request options when configured', async () => {
    const source = createSource();
    source.gb.streamMode = 'TCP-Active';
    source.controlRequest = {
      headers: { Authorization: 'Bearer token-1' },
      credentials: 'include'
    };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        stream_id: 'stream-mode-1',
        play_urls: { ws_flv: 'wss://media.example.com/live.flv' },
        ssrc: '003300'
      })
    });

    const tech = new Gb28181Tech();
    await tech.load(source, {
      video: createVideoStub()
    });

    const inviteOptions = fetchMock.mock.calls[0][1];
    const inviteBody = JSON.parse(inviteOptions.body as string);
    expect(inviteBody.stream_mode).toBe('TCP-Active');
    expect(inviteOptions.headers.Authorization).toBe('Bearer token-1');
    expect(inviteOptions.credentials).toBe('include');
  });

  test('invite falls back to play_urls.urls.ws_flv when url/wsUrl are absent', async () => {
    const source = createSource();
    delete source.responseMapping;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        stream_id: 'stream-456',
        play_urls: { urls: { ws_flv: 'ws://media.example.com/rtp/ABC.live.flv' } },
        ssrc: '009988'
      })
    });

    const tech = new Gb28181Tech();
    await tech.load(source, {
      video: createVideoStub()
    });

    expect(mseStartMock.mock.calls[0][0]).toBe('ws://media.example.com/rtp/ABC.live.flv');
    expect(mseStartMock.mock.calls[0][3]).toBe('flv');
  });

  test('invite can select MPEG-TS MSE playback for gateway TS output', async () => {
    const source = createSource();
    source.format = 'ts';
    source.responseMapping = { url: 'play_urls.urls.ws_ts' };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        stream_id: 'stream-ts',
        play_urls: { urls: { ws_ts: 'wss://media.example.com/live.ts' } }
      })
    });

    const tech = new Gb28181Tech();
    await tech.load(source, {
      video: createVideoStub()
    });

    expect(mseStartMock.mock.calls[0][0]).toBe('wss://media.example.com/live.ts');
    expect(mseStartMock.mock.calls[0][3]).toBe('mpegts');
  });

  test('gb:ptz, gb:bye, gb:query, and gb:keepalive use gateway control endpoints', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          url: 'wss://fallback.example/ws.flv',
          callId: 'call-9',
          ssrc: 'ssrc-9',
          streamId: 'stream-9'
        })
      })
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });

    const tech = new Gb28181Tech();
    await tech.load(createSource(), {
      video: createVideoStub()
    });

    await tech.invoke('gb:ptz', { command: 'left', speed: 5 });
    await tech.invoke('gb:bye');
    await tech.invoke('gb:query', { channelId: 'ch-1' });
    await tech.invoke('gb:keepalive');

    const ptzCall = fetchMock.mock.calls[1];
    expect(ptzCall[0]).toBe('https://api.example.com/ptz');
    const ptzBody = JSON.parse(ptzCall[1].body as string);
    expect(ptzBody).toMatchObject({
      deviceId: 'dev-1',
      channelId: 'ch-1',
      callId: 'call-9',
      ssrc: 'ssrc-9',
      streamId: 'stream-9',
      command: 'left',
      speed: 5
    });

    const byeCall = fetchMock.mock.calls[2];
    expect(byeCall[0]).toBe('https://api.example.com/bye');
    expect(JSON.parse(byeCall[1].body as string)).toMatchObject({
      deviceId: 'dev-1',
      channelId: 'ch-1',
      callId: 'call-9',
      ssrc: 'ssrc-9',
      streamId: 'stream-9'
    });

    expect(fetchMock.mock.calls[3][0]).toBe('https://api.example.com/query');
    expect(JSON.parse(fetchMock.mock.calls[3][1].body as string)).toEqual({ channelId: 'ch-1' });
    expect(fetchMock.mock.calls[4][0]).toBe('https://api.example.com/keepalive');
    expect(JSON.parse(fetchMock.mock.calls[4][1].body as string)).toMatchObject({
      callId: 'call-9',
      ssrc: 'ssrc-9'
    });
  });

  test('control action fails clearly when endpoint is not configured', async () => {
    const source = createSource();
    delete source.control.query;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        url: 'wss://fallback.example/ws.flv',
        callId: 'call-9',
        ssrc: 'ssrc-9'
      })
    });

    const tech = new Gb28181Tech();
    await tech.load(source, {
      video: createVideoStub()
    });

    await expect(tech.invoke('gb:query')).rejects.toThrow('control endpoint not configured');
  });

  test('invite HTTP auth errors include body summary and auth hint', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: { get: () => 'application/json' },
      json: async () => ({
        message: 'missing token',
        code: 'AUTH_REQUIRED',
        details: {
          step: 'invite',
          invite_debug: {
            invite_status: 403,
            invite_reason: 'Forbidden',
            stream_mode: 'TCP-Active'
          }
        }
      })
    });

    const tech = new Gb28181Tech();
    await expect(tech.load(createSource(), { video: createVideoStub() })).rejects.toThrow(
      /missing token.*code=AUTH_REQUIRED.*step=invite.*sip=403 Forbidden.*stream_mode=TCP-Active.*Authorization/
    );
  });
});
