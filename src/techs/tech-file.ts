import { AbstractTech } from './abstractTech.js';
import { BufferPolicy, FileSource, MetadataEvent, MetricsOptions, ReconnectPolicy, Source, WebCodecsConfig } from '../types.js';
import mpegts from 'mpegts.js';
import { WebCodecsDecoder } from './wsRaw/webcodecsDecoder.js';
import { Renderer } from './wsRaw/renderer.js';
import { Demuxer, splitAnnexBNalus, type DemuxerCallbacks } from './wsRaw/demuxer.js';
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
  
  // Metadata extraction state
  private metadataEnabled = false;
  private detectedPrivateDataPids = new Set<number>();
  private readonly mpegtsConfig = {
    enableStashBuffer: true,
    stashInitialSize: 1024 * 1024,
    accurateSeek: true,
    autoCleanupSourceBuffer: true,
    autoCleanupMaxBackwardDuration: 30,
    autoCleanupMinBackwardDuration: 15,
    fixAudioTimestampGap: true,
    lazyLoad: false,
    seekType: 'range' as const,
    reuseRedirectedURL: true
  };

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
    const fileSource = source as FileSource;
    const lower = source.url.toLowerCase();
    const isBlobUrl = source.url.startsWith('blob:');
    
    // Use container hint for blob URLs, otherwise detect from extension
    const container = fileSource.container;
    const isTs = container === 'ts' || (!isBlobUrl && (lower.endsWith('.ts') || lower.includes('.ts?')));
    const isMp4 = container === 'mp4' || (!isBlobUrl && (lower.endsWith('.mp4') || lower.includes('.mp4?')));
    
    this.cleanup();
    
    // Check metadata config from source
    this.metadataEnabled = !!(fileSource.metadata?.privateData?.enable);

    // For blob URLs (local files), prefer mpegts.js for TS as it handles playback better
    // WebCodecs path is better for streaming scenarios
    const useWebCodecsForTs = isTs && opts.webCodecs?.enable && WebCodecsDecoder.isSupported() && !isBlobUrl;

    // TS + WebCodecs (only for non-blob URLs)
    if (useWebCodecsForTs) {
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
      console.log('[file] Using mpegts.js for TS playback, url:', source.url);
      this.tsPlayer = mpegts.createPlayer({
        type: 'mpegts',
        url: source.url,
        isLive: false
      }, this.mpegtsConfig);
      this.tsPlayer.attachMediaElement(this.video);
      console.log('[file] mpegts.js attached to video element:', this.video);
      this.tsPlayer.load();
      console.log('[file] mpegts.js load() called');
      this.bus.emit('ready');
    } else {
      // Native video/MSE
      this.video.src = source.url;
      await this.video.load();
      this.bus.emit('ready');
    }
  }

  override async play(): Promise<void> {
    if (this.tsPlayer) {
      try {
        this.tsPlayer.play();
      } catch {
        /* ignore */
      }
    }
    await super.play();
  }

  override async pause(): Promise<void> {
    if (this.tsPlayer) {
      try {
        this.tsPlayer.pause();
      } catch {
        /* ignore */
      }
    }
    await super.pause();
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
    this.detectedPrivateDataPids.clear();
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
    
    // Create demuxer callbacks for metadata extraction
    const callbacks: DemuxerCallbacks | undefined = this.metadataEnabled ? {
      onPrivateData: (pid: number, data: Uint8Array, pts: number) => {
        const event: MetadataEvent = {
          type: 'private-data',
          raw: data,
          pts,
          pid
        };
        this.bus.emit('metadata', event);
      },
      onPrivateDataDetected: (pid: number, streamType: number) => {
        this.detectedPrivateDataPids.add(pid);
        console.log(`[file] Detected private data PID: 0x${pid.toString(16).toUpperCase()}, stream_type: 0x${streamType.toString(16)}`);
      }
    } : undefined;
    
    // Use full Demuxer with TS format and metadata callbacks
    this.wcDemuxer = new Demuxer({
      format: 'ts',
      callbacks
    });
    
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
        // Only process video frames
        if (f.track !== 'video') continue;
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

  override async seek(time: number): Promise<void> {
    if (this.tsPlayer) {
      // mpegts.js seek handling
      // mpegts.js internally handles seeking by:
      // 1. Flushing current buffer
      // 2. Seeking to nearest keyframe
      // 3. Re-buffering from that point
      // We just need to set currentTime and mpegts.js will handle the rest
      if (this.video) {
        // Pause briefly to allow buffer flush
        const wasPlaying = !this.video.paused;
        
        // Set the time - mpegts.js hooks into video element's seeking events
        this.video.currentTime = time;
        
        // For live streams or when seeking fails, mpegts.js may need a reload
        // But for VOD files, direct currentTime setting should work
        
        // Resume if was playing
        if (wasPlaying) {
          try {
            await this.video.play();
          } catch (e) {
            // Autoplay may be blocked, ignore
          }
        }
      }
      return;
    }
    
    // For WebCodecs paths, seeking is not supported (would need to re-fetch and re-demux)
    if (this.wcDecoder || this.wcMp4Decoder) {
      console.warn('[file] Seeking not supported in WebCodecs mode');
      return;
    }
    
    // For native video/MSE, use default implementation
    await super.seek(time);
  }
}
