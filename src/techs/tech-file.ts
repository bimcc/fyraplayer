import { AbstractTech } from './abstractTech.js';
import { BufferPolicy, MetricsOptions, ReconnectPolicy, Source, WebCodecsConfig } from '../types.js';
import mpegts from 'mpegts.js';
import { WebCodecsDecoder } from './wsRaw/webcodecsDecoder.js';
import { Renderer } from './wsRaw/renderer.js';
import { Demuxer, splitAnnexBNalus } from './wsRaw/demuxer.js';
import { probeWebCodecs } from '../utils/webcodecs.js';

// MP4Box type declaration - should be installed via npm: npm install mp4box
declare const MP4Box: any;
let mp4boxModule: any = null;

/**
 * File/VOD Tech
 * Default: native video/MSE; TS/MP4 + WebCodecs when enabled, fallback on failure.
 */
export class FileTech extends AbstractTech {
  private tsPlayer: mpegts.Player | null = null;
  private wcAbort: AbortController | null = null;
  private wcRenderer: Renderer | null = null;
  private wcDecoder: WebCodecsDecoder | null = null;
  private wcDemuxer: Demuxer | null = null;

  private wcMp4Abort: AbortController | null = null;
  private wcMp4Decoder: VideoDecoder | null = null;
  private wcMp4Renderer: Renderer | null = null;
  private mp4BoxReady = false;

  canPlay(source: Source): boolean {
    return source.type === 'file';
  }

  async load(
    source: Source,
    opts: {
      buffer?: BufferPolicy;
      reconnect?: ReconnectPolicy;
      metrics?: MetricsOptions;
      video: HTMLVideoElement;
      webCodecs?: WebCodecsConfig;
    }
  ): Promise<void> {
    this.source = source;
    this.buffer = opts.buffer;
    this.reconnect = opts.reconnect;
    this.metrics = opts.metrics;
    this.video = opts.video;
    const lower = source.url.toLowerCase();
    const isTs = lower.endsWith('.ts');
    const isMp4 = lower.endsWith('.mp4');
    this.cleanup();

    // TS + WebCodecs
    if (isTs && opts.webCodecs?.enable && WebCodecsDecoder.isSupported()) {
      try {
        await this.loadTsWithWebCodecs(source.url, opts.video);
        this.bus.emit('ready');
        return;
      } catch (err) {
        console.warn('[file] WebCodecs TS failed, fallback to mpegts.js', err);
        this.cleanupWebCodecs();
      }
    }

    // MP4 + WebCodecs (opt-in via preferMp4)
    const preferMp4Wc = !!opts.webCodecs?.enable && (opts.webCodecs as any)?.preferMp4 === true;
    if (isMp4 && preferMp4Wc) {
      const support = await probeWebCodecs();
      if (support.h264 || (opts.webCodecs?.allowH265 && support.h265)) {
        try {
          await this.loadMp4WithWebCodecs(source.url, opts.video, support.h264 ? 'avc1.42E01E' : 'hvc1.1.6.L93.B0');
          this.bus.emit('ready');
          return;
        } catch (err) {
          console.warn('[file] mp4 WebCodecs failed, fallback to native/MSE', err);
          this.cleanupMp4WebCodecs();
        }
      }
    }

    // TS fallback via mpegts.js
    if (isTs && mpegts.isSupported()) {
      this.tsPlayer = mpegts.createPlayer({
        type: 'mpegts',
        url: source.url,
        isLive: false
      });
      this.tsPlayer.attachMediaElement(this.video);
      this.tsPlayer.load();
      this.bus.emit('ready');
    } else {
      // Native video/MSE
      this.video.src = source.url;
      await this.video.load();
      this.bus.emit('ready');
    }
  }

  override async destroy(): Promise<void> {
    this.cleanup();
  }

  private cleanup(): void {
    this.cleanupWebCodecs();
    this.cleanupMp4WebCodecs();
    if (this.tsPlayer) {
      try {
        this.tsPlayer.pause();
        this.tsPlayer.unload();
        this.tsPlayer.detachMediaElement();
        this.tsPlayer.destroy();
      } catch {
        /* ignore */
      }
      this.tsPlayer = null;
    }
    if (this.video) {
      this.video.src = '';
      this.video.srcObject = null;
      try {
        this.video.load();
      } catch {
        /* ignore */
      }
    }
  }

  private cleanupWebCodecs(): void {
    if (this.wcAbort) {
      this.wcAbort.abort();
      this.wcAbort = null;
    }
    this.wcDecoder?.close();
    this.wcDecoder = null;
    this.wcRenderer?.destroy();
    this.wcRenderer = null;
    this.wcDemuxer = null;
  }

  private cleanupMp4WebCodecs(): void {
    if (this.wcMp4Abort) {
      this.wcMp4Abort.abort();
      this.wcMp4Abort = null;
    }
    this.wcMp4Decoder?.close();
    this.wcMp4Decoder = null;
    this.wcMp4Renderer?.destroy();
    this.wcMp4Renderer = null;
  }

  private async loadTsWithWebCodecs(url: string, video: HTMLVideoElement): Promise<void> {
    this.cleanupWebCodecs();
    this.wcAbort = new AbortController();
    this.wcRenderer = new Renderer(video);
    this.wcDemuxer = new Demuxer('ts');
    let decoded = 0;
    let decodeErrors = 0;
    this.wcDecoder = new WebCodecsDecoder((frame) => {
      decoded++;
      this.wcRenderer?.renderFrame(frame);
    });
    await this.wcDecoder.init();
    const res = await fetch(url, { signal: this.wcAbort.signal });
    if (!res.body) throw new Error('ReadableStream not supported');
    const reader = res.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      const frames = this.wcDemuxer.demux(value.buffer);
      for (const f of frames) {
        // Ensure first frame is keyframe; otherwise fallback
        if (decoded === 0 && !f.isKey) continue;
        try {
          this.wcDecoder.decode(f);
        } catch {
          decodeErrors++;
        }
      }
    }
    const decoderErrors = (this.wcDecoder as any)?.getErrorCount?.() ?? 0;
    const totalErrors = decodeErrors + decoderErrors;
    if (!decoded) {
      throw new Error('WebCodecs TS decode failed (no frames), fallback');
    }
    if (totalErrors >= 3) {
      throw new Error('WebCodecs TS decode unstable, fallback to mpegts.js');
    }
    if (totalErrors > 0) {
      this.bus.emit('qos', {
        type: 'webcodecs-ts-warning',
        decodedFrames: decoded,
        decodeErrors: totalErrors
      });
    }
  }

  // MP4 WebCodecs path via MP4Box streaming demux (video only)
  private async loadMp4WithWebCodecs(url: string, video: HTMLVideoElement, codec: string): Promise<void> {
    await this.ensureMp4Box();
    if (!mp4boxModule) throw new Error('MP4Box not available');
    this.cleanupMp4WebCodecs();
    this.wcMp4Abort = new AbortController();
    this.wcMp4Renderer = new Renderer(video);

    const file = mp4boxModule.createFile ? mp4boxModule.createFile() : mp4boxModule.default.createFile();
    let videoTrackId: number | null = null;
    let timescale = 1000;
    let nalLengthSize = 4;

    file.onReady = (info: any) => {
      const v = info.tracks.find((t: any) => t.video);
      if (!v) throw new Error('no video track in mp4');
      videoTrackId = v.id;
      timescale = v.timescale || 1000;
      nalLengthSize = (v.avcC && v.avcC.nalUintLength) || 4;
      file.setExtractionOptions(videoTrackId, null, { nbSamples: 8 });
      file.start();
    };

    file.onSamples = (id: number, _user: any, samples: any[]) => {
      if (id !== videoTrackId || !this.wcMp4Decoder) return;
      for (const s of samples) {
        const annexb = this.avccToAnnexB(new Uint8Array(s.data), nalLengthSize);
        const ptsMs = ((s.dts + s.cts) / (timescale || 1)) * 1000;
        const chunk = new EncodedVideoChunk({
          type: s.is_sync ? 'key' : 'delta',
          timestamp: Math.max(0, Math.round(ptsMs * 1000)), // microseconds
          data: annexb
        });
        try {
          this.wcMp4Decoder.decode(chunk);
        } catch (e) {
          console.warn('[file] mp4 decode error', e);
        }
      }
    };

    this.wcMp4Decoder = new VideoDecoder({
      output: (frame) => {
        this.wcMp4Renderer?.renderFrame(frame);
        frame.close();
      },
      error: (e) => console.error('[file] mp4 decode error', e)
    });
    await this.wcMp4Decoder.configure({ codec });

    const res = await fetch(url, { signal: this.wcMp4Abort.signal });
    if (!res.body) throw new Error('ReadableStream not supported');
    const reader = res.body.getReader();
    let offset = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      const buf = value.buffer;
      (buf as any).fileStart = offset;
      offset += value.byteLength;
      file.appendBuffer(buf);
    }
    file.flush();
  }

  private avccToAnnexB(avcc: Uint8Array, nalSize = 4): Uint8Array {
    const out: number[] = [];
    let offset = 0;
    while (offset + nalSize <= avcc.byteLength) {
      let size = 0;
      for (let i = 0; i < nalSize; i++) size = (size << 8) | avcc[offset + i];
      offset += nalSize;
      if (offset + size > avcc.byteLength) break;
      out.push(0x00, 0x00, 0x00, 0x01, ...avcc.subarray(offset, offset + size));
      offset += size;
    }
    return new Uint8Array(out);
  }

  private async ensureMp4Box(): Promise<void> {
    if (this.mp4BoxReady && mp4boxModule) return;
    // Try to import mp4box as ES module first (npm install mp4box)
    try {
      mp4boxModule = await import('mp4box');
      this.mp4BoxReady = true;
      return;
    } catch {
      // mp4box not installed as npm dependency
    }
    // Fallback: check if MP4Box is globally available
    if (typeof MP4Box !== 'undefined') {
      mp4boxModule = { createFile: MP4Box.createFile };
      this.mp4BoxReady = true;
      return;
    }
    throw new Error('MP4Box not available. Please install via: npm install mp4box');
  }
}
