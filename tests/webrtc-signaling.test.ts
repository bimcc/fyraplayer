import { enhanceNetworkEvent } from '../src/core/networkEvents.js';
import { WhipSignaling } from '../src/techs/webrtc/signaling.js';

type Listener = () => void;

class PeerConnectionStub {
  localDescription: RTCSessionDescriptionInit | null = null;
  iceGatheringState: RTCIceGatheringState = 'complete';
  remoteDescriptionError: Error | null = null;
  private readonly listeners = new Set<Listener>();

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'offer-sdp' };
  }

  async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = description;
  }

  async setRemoteDescription(_description: RTCSessionDescriptionInit): Promise<void> {
    if (this.remoteDescriptionError) throw this.remoteDescriptionError;
  }

  addEventListener(event: string, listener: Listener): void {
    if (event === 'icegatheringstatechange') this.listeners.add(listener);
  }

  removeEventListener(event: string, listener: Listener): void {
    if (event === 'icegatheringstatechange') this.listeners.delete(listener);
  }
}

function sdpResponse(body: string, init?: ResponseInit): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/sdp' },
    ...init,
  });
}

describe('WhipSignaling WHEP/WHIP diagnostics', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    Object.defineProperty(globalThis, 'fetch', { value: originalFetch, configurable: true });
    jest.useRealTimers();
  });

  test('emits HTTP diagnostics for non-2xx WHEP responses', async () => {
    const events: Array<Record<string, unknown>> = [];
    Object.defineProperty(globalThis, 'fetch', {
      value: jest.fn().mockResolvedValue(new Response('bad whep', { status: 500, statusText: 'Server Error' })),
      configurable: true,
    });

    const signaling = new WhipSignaling({
      url: 'https://example.com/live/whep',
      onEvent: (event) => events.push(event),
    });

    await expect(signaling.negotiate(new PeerConnectionStub() as unknown as RTCPeerConnection)).rejects.toThrow('500');

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'whep-http-error',
        fatal: true,
        status: 500,
      })
    );
    expect(enhanceNetworkEvent(events[0])).toEqual(
      expect.objectContaining({
        code: 'WEBRTC_WHEP_HTTP_ERROR',
        severity: 'fatal',
      })
    );
  });

  test('emits ICE gathering timeout warning and still posts current SDP', async () => {
    jest.useFakeTimers();
    const events: Array<Record<string, unknown>> = [];
    const fetchMock = jest.fn().mockResolvedValue(sdpResponse('answer-sdp'));
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });
    const pc = new PeerConnectionStub();
    pc.iceGatheringState = 'gathering';

    const signaling = new WhipSignaling({
      url: 'https://example.com/live/whep',
      iceGatheringTimeoutMs: 25,
      onEvent: (event) => events.push(event),
    });

    const negotiate = signaling.negotiate(pc as unknown as RTCPeerConnection);
    await jest.advanceTimersByTimeAsync(25);
    await negotiate;

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/live/whep',
      expect.objectContaining({
        method: 'POST',
        body: 'offer-sdp',
      })
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'whep-ice-gathering-timeout',
        warning: true,
        timeoutMs: 25,
      })
    );
    expect(enhanceNetworkEvent(events[0])).toEqual(
      expect.objectContaining({
        code: 'WEBRTC_WHEP_ICE_GATHERING_TIMEOUT',
        severity: 'warning',
      })
    );
  });

  test('emits answer diagnostics when remote SDP cannot be applied', async () => {
    const events: Array<Record<string, unknown>> = [];
    Object.defineProperty(globalThis, 'fetch', {
      value: jest.fn().mockResolvedValue(sdpResponse('not-valid-for-this-stub')),
      configurable: true,
    });
    const pc = new PeerConnectionStub();
    pc.remoteDescriptionError = new Error('bad answer');

    const signaling = new WhipSignaling({
      url: 'https://example.com/live/whep',
      onEvent: (event) => events.push(event),
    });

    await expect(signaling.negotiate(pc as unknown as RTCPeerConnection)).rejects.toThrow('bad answer');

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'whep-answer-error',
        fatal: true,
      })
    );
    expect(enhanceNetworkEvent(events[0])).toEqual(
      expect.objectContaining({
        code: 'WEBRTC_WHEP_ANSWER_ERROR',
        severity: 'fatal',
      })
    );
  });
});
