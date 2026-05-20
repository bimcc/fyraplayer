import { FyraPlayer } from "../src/index.js";
import {
  getSourcePresentation,
  isPanoramaSource,
  type SourcePresentationConfig,
  type SourceMetadata
} from "../src/index.js";
import defaultSources from "./sources.js";
import { createUiComponentsPlugin } from "../src/ui/index.js";
import { createPanoramaLitePlugin, type PanoramaLiteHandle } from "../src/plugins/panoramalite.js";
import { createDashTechPlugin } from "../src/plugins/dash.js";

type SourceType = "auto" | "hls" | "dash" | "fmp4" | "ws-raw" | "file" | "webrtc" | "webrtc-oven" | "gb28181";
type SimpleSource = {
  label: string;
  type: SourceType;
  url: string;
  lowLatency?: boolean;
  fmp4?: {
    transport?: "http" | "ws";
    codec?: "h264" | "h265" | "av1";
    audioCodec?: "aac" | "opus" | "mp3";
    mimeType?: string;
    videoCodecString?: string;
    audioCodecString?: string;
    isLive?: boolean;
  };
  webCodecs?: { enable?: boolean; preferMp4?: boolean; allowH265?: boolean };
  presentation?: SourcePresentationConfig;
  tags?: string[];
  meta?: SourceMetadata;
  panorama?: boolean;
  textureFlipX?: boolean;
  textureFlipY?: boolean;
  gb?: {
    invite?: string;
    deviceId?: string;
    channelId?: string;
    token?: string;
    includeCredentials?: boolean;
    responseMapping?: {
      url?: string;
      callId?: string;
      ssrc?: string;
      streamInfo?: string;
      streamId?: string;
    };
    format?: "flv" | "ts";
    streamMode?: "" | "UDP" | "TCP-Active" | "TCP-Passive";
  };
};

const video = document.getElementById("player") as HTMLVideoElement;
const select = document.getElementById("source-select") as HTMLSelectElement;
const urlInput = document.getElementById("input-url") as HTMLInputElement;
const typeSelect = document.getElementById("type-select") as HTMLSelectElement;
const statsEl = document.getElementById("stats") as HTMLDivElement;
const playBtn = document.getElementById("btn-play") as HTMLButtonElement;
const pauseBtn = document.getElementById("btn-pause") as HTMLButtonElement;
const loadBtn = document.getElementById("btn-load") as HTMLButtonElement;
const tsNote = document.getElementById("ts-note") as HTMLDivElement;
const wcSupport = document.getElementById("wc-support") as HTMLDivElement;
const logEl = document.getElementById("log") as HTMLDivElement;
const skinToggle = document.getElementById("toggle-skin") as HTMLInputElement;
const nativeToggle = document.getElementById("toggle-native") as HTMLInputElement;
const lowLatencyToggle = document.getElementById("toggle-low-latency") as HTMLInputElement;
const panoramaToggle = document.getElementById("toggle-panorama") as HTMLInputElement | null;
const panoramaOptions = document.getElementById("panorama-options") as HTMLDivElement | null;
const panoramaFlipXToggle = document.getElementById("toggle-panorama-flip-x") as HTMLInputElement | null;
const panoramaFlipYToggle = document.getElementById("toggle-panorama-flip-y") as HTMLInputElement | null;
const panoramaResetBtn = document.getElementById("btn-panorama-reset") as HTMLButtonElement | null;
const panoramaStatus = document.getElementById("panorama-status") as HTMLDivElement | null;
const pluginStatus = document.getElementById("plugin-status") as HTMLDivElement | null;
const overlay = document.getElementById("overlay") as HTMLDivElement | null;
const overlayText = document.getElementById("overlay-text") as HTMLDivElement | null;
const gbInviteInput = document.getElementById("gb-invite") as HTMLInputElement | null;
const gbParseBtn = document.getElementById("gb-parse") as HTMLButtonElement | null;
const gbDeviceInput = document.getElementById("gb-device") as HTMLInputElement | null;
const gbChannelInput = document.getElementById("gb-channel") as HTMLInputElement | null;
const gbTokenInput = document.getElementById("gb-token") as HTMLInputElement | null;
const gbFormatSelect = document.getElementById("gb-format") as HTMLSelectElement | null;
const gbStreamModeSelect = document.getElementById("gb-stream-mode") as HTMLSelectElement | null;
const gbCredsCheckbox = document.getElementById("gb-creds") as HTMLInputElement | null;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const openFileBtn = document.getElementById("btn-open-file") as HTMLButtonElement;

let player: FyraPlayer | null = null;
let busy: string | false = false;
let operationQueue: Promise<void> = Promise.resolve();
let uiStatus: "idle" | "loading" | "ready" | "playing" | "paused" | "ended" | "error" | "buffering" = "idle";
let currentSrc: SimpleSource | null = null;
let panoramaHandle: PanoramaLiteHandle | null = null;
let panoramaMode = false;
let activePanoramaTextureFlipX = false;
let activePanoramaTextureFlipY = false;
let useSkin = true;
let hideNativeControls = false;
let latestStatsEvent: any = null;
let latestNetworkEvent: any = null;
let latestQosEvent: any = null;
let longRunStartedAt = 0;
let longRunTimer: number | null = null;
let longRunSamples: any[] = [];
// Expose for debugging (e.g., window.fyraPlayer.on('stats', console.log))
(window as any).fyraPlayer = null;

const CUSTOM_VALUE = "custom";

// 动态补充 Oven WebRTC 模式选项
if (!Array.from(typeSelect.options).some((o) => o.value === "webrtc-oven")) {
  const opt = document.createElement("option");
  opt.value = "webrtc-oven";
  opt.textContent = "WebRTC (Oven WS)";
  typeSelect.appendChild(opt);
}

const presetSources: SimpleSource[] = [
  { label: "HLS demo", type: "hls", url: "https://sf1-cdn-tos.huoshanstatic.com/obj/media-fe/xgplayer_doc_video/hls/xgplayer-demo.m3u8" },
  { label: "Apple HLS fMP4/CMAF sample", type: "hls", url: "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8" },
  { label: "MediaMTX HLS local (live/test)", type: "hls", url: "http://127.0.0.1:8888/live/test/index.m3u8", lowLatency: false },
  { label: "MediaMTX LL-HLS local (live/test)", type: "hls", url: "http://127.0.0.1:8888/live/test/index.m3u8", lowLatency: true },
  { label: "MediaMTX WebRTC WHEP local (live/test)", type: "webrtc", url: "http://127.0.0.1:8889/live/test/whep" },
  {
    label: "ffmpeg fMP4 HTTP local (stream.fmp4)",
    type: "fmp4",
    url: "/ffmpeg-fmp4/stream.fmp4",
    fmp4: { transport: "http", codec: "h264", audioCodec: "aac", videoCodecString: "avc1.4d401f", audioCodecString: "mp4a.40.2", isLive: true }
  },
  { label: "DASH bbb", type: "dash", url: "https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd" },
  { label: "DASH sintel", type: "dash", url: "https://bitmovin-a.akamaihd.net/content/sintel/sintel.mpd" },
  { label: "MP4 demo", type: "file", url: "https://sf1-cdn-tos.huoshanstatic.com/obj/media-fe/xgplayer_doc_video/mp4/xgplayer-demo-360p.mp4" },
  { label: "TS 本地 (/testvideo/DJI_20250611085647_0001_V.TS)", type: "file", url: "/testvideo/DJI_20250611085647_0001_V.TS", webCodecs: { enable: true, preferMp4: false } },
  { label: "MP4 本地 (/testvideo/Rec 0017.mp4)", type: "file", url: "/testvideo/Rec%200017.mp4", webCodecs: { enable: true, preferMp4: true } },
  { label: "FLV demo (ws-raw)", type: "ws-raw", url: "https://sf1-cdn-tos.huoshanstatic.com/obj/media-fe/xgplayer_doc_video/flv/xgplayer-demo-360p.flv" }
];

function sourceKey(source: SimpleSource): string {
  return [
    source.type,
    source.url,
    source.lowLatency === true ? "ll" : "normal",
    isPanoramaSource(source as any) ? "pano" : "ordinary"
  ].join("|");
}

const knownSourceKeys = new Set(presetSources.map(sourceKey));

function pushPresetSource(source: SimpleSource): void {
  const key = sourceKey(source);
  if (knownSourceKeys.has(key)) return;
  knownSourceKeys.add(key);
  presetSources.push(source);
}

function formatSourceLabel(source: SimpleSource): string {
  if (!isPanoramaSource(source as any)) return source.label;
  return source.label.startsWith("[全景]") ? source.label : `[全景] ${source.label}`;
}

function resolvePresentation(source: SimpleSource): SourcePresentationConfig | undefined {
  return getSourcePresentation(source as any);
}

function resolveTextureFlip(source: SimpleSource): { textureFlipX: boolean; textureFlipY: boolean } {
  const presentation = resolvePresentation(source);
  return {
    textureFlipX: typeof source.textureFlipX === "boolean" ? source.textureFlipX : !!presentation?.textureFlipX,
    textureFlipY: typeof source.textureFlipY === "boolean" ? source.textureFlipY : !!presentation?.textureFlipY
  };
}

function sourceBaseFields(src: SimpleSource): {
  presentation?: SourcePresentationConfig;
  tags?: string[];
  meta?: SourceMetadata;
} {
  const presentation = resolvePresentation(src);
  return {
    ...(presentation ? { presentation } : undefined),
    ...(src.tags ? { tags: src.tags } : undefined),
    ...(src.meta ? { meta: src.meta } : undefined)
  };
}

defaultSources?.forEach((s: any, idx: number) => {
  pushPresetSource({
    label: s.label || `Default ${idx} - ${s.type}`,
    type: s.type,
    url: s.url,
    lowLatency: (s as any).lowLatency,
    presentation: (s as any).presentation,
    tags: (s as any).tags,
    meta: (s as any).meta,
    panorama: !!(s as any).panorama,
    textureFlipX: (s as any).textureFlipX,
    textureFlipY: (s as any).textureFlipY,
    fmp4: s.type === "fmp4"
      ? {
          transport: (s as any).transport,
          codec: (s as any).codec,
          audioCodec: (s as any).audioCodec,
          mimeType: (s as any).mimeType,
          videoCodecString: (s as any).videoCodecString,
          audioCodecString: (s as any).audioCodecString,
          isLive: (s as any).isLive
        }
      : undefined,
    webCodecs: (s as any).webCodecs
  });
});

function populateSelect() {
  select.innerHTML = "";
  const custom = document.createElement("option");
  custom.value = CUSTOM_VALUE;
  custom.textContent = "输入自定义";
  select.appendChild(custom);
  presetSources.forEach((s, idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx);
    opt.textContent = formatSourceLabel(s);
    select.appendChild(opt);
  });
  select.value = CUSTOM_VALUE;
}

function syncUiWithSource(src: SimpleSource) {
  urlInput.value = src.url;
  typeSelect.value = src.type;
  if (src.type === "file" && src.url.toLowerCase().endsWith(".ts")) {
    tsNote.textContent = "提示：本地 TS 需通过 http 服务访问，如 http://localhost:3000/DJI_20250611085647_0001_V.TS";
  } else {
    tsNote.textContent = "";
  }
  if (src.type === "gb28181" && src.gb) {
    if (gbInviteInput) gbInviteInput.value = src.gb.invite || "";
    if (gbDeviceInput) gbDeviceInput.value = src.gb.deviceId || "";
    if (gbChannelInput) gbChannelInput.value = src.gb.channelId || "";
    if (gbFormatSelect) gbFormatSelect.value = src.gb.format || "flv";
    if (gbStreamModeSelect) gbStreamModeSelect.value = src.gb.streamMode || "";
    if (gbTokenInput) gbTokenInput.value = src.gb.token || "";
    if (gbCredsCheckbox) gbCredsCheckbox.checked = !!src.gb.includeCredentials;
    if ((!src.gb.deviceId || !src.gb.channelId) && src.gb.invite) {
      syncGbFieldsFromInvite();
    }
  }
  if (lowLatencyToggle && typeof src.lowLatency === "boolean") {
    lowLatencyToggle.checked = src.lowLatency;
  }
  const texture = resolveTextureFlip(src);
  if (panoramaFlipXToggle) panoramaFlipXToggle.checked = texture.textureFlipX;
  if (panoramaFlipYToggle) panoramaFlipYToggle.checked = texture.textureFlipY;
  setPanoramaMode(isPanoramaSource(src as any), { updateCurrentSource: false });
}

function setBusy(flag: string | false, message?: string) {
  busy = flag;
  // Normal skin has its own spinner; PanoramaLite mode hides the skin and uses this overlay.
  if (overlay && overlayText) {
    if (flag && (!useSkin || panoramaMode)) {
      overlay.classList.add("visible");
      overlayText.textContent = message || `${flag}...`;
    } else {
      overlay.classList.remove("visible");
      overlayText.textContent = "";
    }
  }
  const disabled = !!flag;
  playBtn.disabled = disabled;
  pauseBtn.disabled = false;
  loadBtn.disabled = disabled;
  select.disabled = disabled;
  typeSelect.disabled = disabled;
  urlInput.disabled = disabled;
  if (panoramaToggle) panoramaToggle.disabled = disabled;
  if (panoramaFlipXToggle) panoramaFlipXToggle.disabled = disabled || !panoramaMode;
  if (panoramaFlipYToggle) panoramaFlipYToggle.disabled = disabled || !panoramaMode;
  if (panoramaResetBtn) panoramaResetBtn.disabled = disabled || !panoramaMode;
}

function setStatus(status: typeof uiStatus, message?: string) {
  uiStatus = status;
  if (status === "loading" || status === "buffering") {
    setBusy("loading", message || "Loading...");
  } else if (busy) {
    setBusy(false);
  }
  if (message) appendLog(message);
}

function appendLog(msg: string) {
  const now = new Date().toLocaleTimeString();
  const text = `[${now}] ${msg}`;
  const current = logEl.textContent || "";
  logEl.textContent = current ? `${current}\n${text}` : text;
  try {
    console.info(msg);
  } catch {
    /* ignore */
  }
}

function getActiveBufferedRange() {
  if (!video || !video.buffered?.length) return null;
  const current = video.currentTime || 0;
  for (let i = 0; i < video.buffered.length; i += 1) {
    const start = video.buffered.start(i);
    const end = video.buffered.end(i);
    if (current >= start && current <= end) {
      return { start, end, level: Math.max(0, end - current) };
    }
  }
  const last = video.buffered.length - 1;
  return {
    start: video.buffered.start(last),
    end: video.buffered.end(last),
    level: Math.max(0, video.buffered.end(last) - current)
  };
}

function collectLongRunSample() {
  const qualityState = player?.getQualityState?.();
  const playbackQuality = typeof video.getVideoPlaybackQuality === "function"
    ? video.getVideoPlaybackQuality()
    : null;
  const memory = (performance as any).memory;
  const sample = {
    ts: new Date().toISOString(),
    elapsedSec: longRunStartedAt ? Math.round((Date.now() - longRunStartedAt) / 1000) : 0,
    state: player?.getState?.() || uiStatus,
    source: currentSrc
      ? {
          label: currentSrc.label,
          type: currentSrc.type,
          url: currentSrc.url,
          lowLatency: currentSrc.lowLatency,
          panorama: isPanoramaSource(currentSrc as any),
          presentation: resolvePresentation(currentSrc)
        }
      : null,
    tech: qualityState?.tech || null,
    quality: qualityState || null,
    video: {
      currentTime: video.currentTime,
      readyState: video.readyState,
      paused: video.paused,
      ended: video.ended,
      width: video.videoWidth,
      height: video.videoHeight,
      buffered: getActiveBufferedRange(),
      totalFrames: playbackQuality?.totalVideoFrames,
      droppedFrames: playbackQuality?.droppedVideoFrames
    },
    dom: {
      video: document.querySelectorAll("video").length,
      audio: document.querySelectorAll("audio").length,
      uiShell: document.querySelectorAll("fyra-ui-shell").length,
      panoramaCanvas: document.querySelectorAll(".fyra-panoramalite").length
    },
    memory: memory
      ? {
          usedJSHeapSize: memory.usedJSHeapSize,
          totalJSHeapSize: memory.totalJSHeapSize,
          jsHeapSizeLimit: memory.jsHeapSizeLimit
        }
      : null,
    lastStats: latestStatsEvent,
    lastNetwork: latestNetworkEvent,
    lastQos: latestQosEvent
  };
  longRunSamples.push(sample);
  return sample;
}

function startLongRunSampling(intervalMs = 10000) {
  stopLongRunSampling();
  longRunStartedAt = Date.now();
  longRunSamples = [];
  collectLongRunSample();
  longRunTimer = window.setInterval(collectLongRunSample, Math.max(1000, intervalMs));
  appendLog(`long-run sampling started: interval=${Math.max(1000, intervalMs)}ms`);
  return longRunSamples;
}

function stopLongRunSampling() {
  if (longRunTimer !== null) {
    window.clearInterval(longRunTimer);
    longRunTimer = null;
  }
  return longRunSamples;
}

(window as any).fyraLongRun = {
  start: startLongRunSampling,
  stop: stopLongRunSampling,
  sample: collectLongRunSample,
  clear: () => {
    longRunStartedAt = Date.now();
    longRunSamples = [];
    return longRunSamples;
  },
  getSamples: () => longRunSamples,
  getJson: () => JSON.stringify(longRunSamples, null, 2)
};

function applyLowLatencyToggle(src: SimpleSource): SimpleSource {
  if (!lowLatencyToggle) return src;
  const pick = src.type === "auto" ? detectType(src.url) : src.type;
  if (pick !== "hls") return src;
  if (src.lowLatency === lowLatencyToggle.checked) return src;
  return { ...src, lowLatency: lowLatencyToggle.checked };
}

function getPlayerHost(): HTMLElement | null {
  return document.querySelector(".player-shell") as HTMLElement | null;
}

function setNativeControlVisibility(): void {
  video.controls = !hideNativeControls && !useSkin && !panoramaMode;
}

function getPanoramaTextureSettings(): { textureFlipX: boolean; textureFlipY: boolean } {
  return {
    textureFlipX: !!panoramaFlipXToggle?.checked,
    textureFlipY: !!panoramaFlipYToggle?.checked
  };
}

function updateCurrentPanoramaSource(enabled = panoramaMode): SimpleSource | null {
  if (!currentSrc) return null;
  const previousPresentation = resolvePresentation(currentSrc) || {};
  const texture = getPanoramaTextureSettings();
  currentSrc = {
    ...currentSrc,
    panorama: enabled,
    presentation: {
      ...previousPresentation,
      mode: enabled ? "panorama" : "normal",
      projection: previousPresentation.projection || "equirectangular",
      renderer: previousPresentation.renderer || "panoramalite",
      ...texture
    },
    ...texture
  };
  return currentSrc;
}

function syncPanoramaModeUi(): void {
  const host = getPlayerHost();
  host?.classList.toggle("panorama-mode", panoramaMode);
  if (panoramaOptions) panoramaOptions.hidden = !panoramaMode;
  if (panoramaStatus) {
    const flipLabel = `flipX=${activePanoramaTextureFlipX ? "on" : "off"} / flipY=${activePanoramaTextureFlipY ? "on" : "off"}`;
    const rendererState = panoramaHandle ? (panoramaHandle.isEnabled() ? "active" : "standby") : "not-ready";
    panoramaStatus.textContent = panoramaMode
      ? `PanoramaLite: ${rendererState} / ${flipLabel}`
      : `PanoramaLite: standby / ${flipLabel}`;
  }
  if (pluginStatus) {
    pluginStatus.textContent = `plugins: ui=${useSkin ? "on" : "off"} | panoramalite=${panoramaHandle ? (panoramaMode ? "on" : "standby") : "not-ready"}`;
  }
  setNativeControlVisibility();
  if (busy) setBusy(busy);
}

function setPanoramaMode(
  enabled: boolean,
  options: { updateCurrentSource?: boolean; reloadIfTextureChanged?: boolean } = {}
): void {
  const next = !!enabled;
  const texture = getPanoramaTextureSettings();
  panoramaMode = next;
  if (panoramaToggle) panoramaToggle.checked = next;
  if (options.updateCurrentSource !== false) {
    updateCurrentPanoramaSource(next);
  }
  const textureChanged = next && (
    texture.textureFlipX !== activePanoramaTextureFlipX ||
    texture.textureFlipY !== activePanoramaTextureFlipY
  );
  if (options.reloadIfTextureChanged && textureChanged && currentSrc) {
    void safeRun("load", () => createPlayer(updateCurrentPanoramaSource(next) as SimpleSource));
    syncPanoramaModeUi();
    return;
  }
  panoramaHandle?.setEnabled(next);
  syncPanoramaModeUi();
}

function parseGbInviteUrl(inviteUrl: string): {
  channelId?: string;
  deviceId?: string;
  byeUrl?: string;
  ptzUrl?: string;
} | null {
  if (!inviteUrl) return null;

  const replaceInvitePath = (url: string, suffix: "bye" | "ptz"): string => {
    return url.replace(/\/invite(?=(?:\/)?(?:\?|$))/i, `/${suffix}`);
  };

  try {
    const parsed = new URL(inviteUrl, window.location.origin);
    const channelMatch = parsed.pathname.match(/\/api\/v1\/gb\/channels\/([^/]+)\/invite\/?$/i);
    const channelId = channelMatch?.[1] ? decodeURIComponent(channelMatch[1]) : undefined;
    const deviceId = parsed.searchParams.get("device_id") || parsed.searchParams.get("deviceId") || undefined;

    const bye = new URL(parsed.toString());
    bye.pathname = parsed.pathname.replace(/\/invite\/?$/i, "/bye");
    const ptz = new URL(parsed.toString());
    ptz.pathname = parsed.pathname.replace(/\/invite\/?$/i, "/ptz");

    return {
      channelId,
      deviceId,
      byeUrl: bye.pathname === parsed.pathname ? replaceInvitePath(parsed.toString(), "bye") : bye.toString(),
      ptzUrl: ptz.pathname === parsed.pathname ? replaceInvitePath(parsed.toString(), "ptz") : ptz.toString()
    };
  } catch {
    return {
      byeUrl: replaceInvitePath(inviteUrl, "bye"),
      ptzUrl: replaceInvitePath(inviteUrl, "ptz")
    };
  }
}

function syncGbFieldsFromInvite(): { deviceId?: string; channelId?: string } {
  const invite = gbInviteInput?.value.trim() || "";
  if (!invite) return {};
  const parsed = parseGbInviteUrl(invite);
  if (!parsed) return {};
  if (gbDeviceInput && parsed.deviceId) gbDeviceInput.value = parsed.deviceId;
  if (gbChannelInput && parsed.channelId) gbChannelInput.value = parsed.channelId;
  return { deviceId: parsed.deviceId, channelId: parsed.channelId };
}

function toPlayerSource(src: SimpleSource): import('../src/types.js').Source {
  const pick = src.type === "auto" ? detectType(src.url) : src.type;
  const base = sourceBaseFields(src);
  if (pick === "hls") return { type: "hls" as const, url: src.url, lowLatency: src.lowLatency, ...base, preferTech: "hls" as const };
  if (pick === "dash") return { type: "dash" as const, url: src.url, ...base, preferTech: "dash" as const };
  if (pick === "fmp4") {
    const fmp4 = src.fmp4 || {};
    const videoCodecString = fmp4.videoCodecString
      || (fmp4.codec === "h265"
        ? "hvc1.1.6.L93.B0"
        : fmp4.codec === "av1"
          ? "av01.0.04M.08"
          : "avc1.4d401f");
    const audioCodecString = fmp4.audioCodecString
      || (fmp4.audioCodec === "opus"
        ? "opus"
        : fmp4.audioCodec === "mp3"
          ? "mp3"
          : "mp4a.40.2");
    return {
      type: "fmp4" as const,
      url: src.url,
      transport: fmp4.transport || (src.url.toLowerCase().startsWith("ws") ? "ws" as const : "http" as const),
      codec: fmp4.codec || "h264" as const,
      audioCodec: fmp4.audioCodec || "aac" as const,
      mimeType: fmp4.mimeType,
      videoCodecString,
      audioCodecString,
      isLive: fmp4.isLive ?? true,
      ...base,
      preferTech: "fmp4" as const
    };
  }
  if (pick === "ws-raw") return { type: "ws-raw" as const, url: src.url, codec: "h264" as const, transport: "flv" as const, ...base, preferTech: "ws-raw" as const };
  if (pick === "gb28181") {
    const gb = src.gb || {};
    const invite = gb.invite || "";
    const parsedInvite = parseGbInviteUrl(invite);
    const deviceId = gb.deviceId || parsedInvite?.deviceId || "";
    const channelId = gb.channelId || parsedInvite?.channelId || "";
    const responseMapping = {
      url: gb.responseMapping?.url || "play_urls.urls.ws_flv",
      callId: gb.responseMapping?.callId || "stream_id",
      streamId: gb.responseMapping?.streamId || "stream_id",
      ssrc: gb.responseMapping?.ssrc,
      streamInfo: gb.responseMapping?.streamInfo
    };
    return {
      type: "gb28181" as const,
      url: src.url,
      control: {
        invite,
        bye: parsedInvite?.byeUrl || (invite ? invite.replace(/\/invite(?=(?:\/)?(?:\?|$))/i, "/bye") : ""),
        ptz: parsedInvite?.ptzUrl || (invite ? invite.replace(/\/invite(?=(?:\/)?(?:\?|$))/i, "/ptz") : "")
      },
      controlRequest: {
        headers: gb.token ? { Authorization: gb.token.startsWith("Bearer ") ? gb.token : `Bearer ${gb.token}` } : undefined,
        credentials: gb.includeCredentials ? "include" : undefined
      },
      gb: {
        deviceId,
        channelId,
        streamMode: gb.streamMode || undefined
      },
      responseMapping,
      ...base,
      format: gb.format || "flv"
    };
  }
  if (pick === "webrtc-oven" || pick === "webrtc") {
    // WebRTC source - tech-webrtc 会自动检测 wss:// URL 并使用 oven-ws 信令
    // 对于 http(s):// URL，会自动使用 WHEP 信令
    return { type: "webrtc" as const, url: src.url, ...base, preferTech: "webrtc" as const };
  }
  // File source - include container hint for blob URLs
  return { 
    type: "file" as const, 
    url: src.url, 
    ...base,
    preferTech: "file" as const, 
    webCodecs: src.webCodecs,
    container: (src as any).container as 'ts' | 'mp4' | undefined
  };
}

function detectType(url: string): Exclude<SourceType, "auto"> {
  const lower = url.toLowerCase();
  if (lower.endsWith(".m3u8")) return "hls";
  if (lower.endsWith(".mpd")) return "dash";
  if (lower.endsWith(".fmp4") || lower.includes("/fmp4/") || lower.includes("stream.fmp4")) return "fmp4";
  if (lower.endsWith(".flv")) return "ws-raw";
  if (lower.includes("/whep") || lower.includes(":8889/") || lower.includes(":28889/")) return "webrtc";
  if (lower.startsWith("ws://") || lower.startsWith("wss://")) return "webrtc-oven";
  if (lower.endsWith(".ts") || lower.endsWith(".mp4")) return "file";
  return "file";
}

function bindPlayerEvents(p: FyraPlayer) {
  p.on("ready", () => setStatus("ready"));
  p.on("play", () => setStatus("playing"));
  p.on("pause", () => setStatus("paused"));
  p.on("ended", () => setStatus("ended"));
  p.on("error", (e: any) => setStatus("error", `error: ${e?.message || e}`));
  p.on("network", (evt: any) => {
    latestNetworkEvent = evt;
    const msg = `network: ${JSON.stringify(evt)}`;
    appendLog(msg);
    if (evt?.type === "reconnect") {
      setStatus("loading", `reconnecting (${evt.attempt || 0}/${evt.maxRetries || 0})...`);
      return;
    }
    if (evt?.type === "reconnect-exhausted") {
      setStatus("error", `reconnect exhausted (${evt.attempt || 0}/${evt.maxRetries || 0})`);
      return;
    }
    if (evt?.severity === "fatal" || evt?.fatal) {
      const reason = evt?.message || evt?.type || "fatal network error";
      setStatus("error", `fatal: ${reason}`);
    }
  });
  p.on("qos", (evt: any) => {
    latestQosEvent = evt;
    if (evt?.code || evt?.type) {
      const code = evt?.code || evt?.type || "qos";
      appendLog(`qos[${code}]: ${JSON.stringify(evt)}`);
    }
  });
  p.on("buffer", () => setStatus("loading", "buffering..."));
  p.on("stats", ({ stats }) => {
    latestStatsEvent = stats;
    if (!stats) return;
    statsEl.textContent = `bitrate: ${stats.bitrateKbps || "-"} kbps | fps: ${stats.fps || "-"} | res: ${stats.width || "-"}x${stats.height || "-"}`;
  });
}

async function createPlayer(source: SimpleSource) {
  if (player) {
    const previous = player;
    player = null;
    (window as any).fyraPlayer = null;
    (window as any).fyraPanoramaHandle = null;
    panoramaHandle = null;
    await previous.destroy().catch(() => {});
  }
  const effectiveSource = applyLowLatencyToggle(source);
  const sourcePanoramaMode = isPanoramaSource(effectiveSource as any) || !!panoramaToggle?.checked;
  panoramaMode = sourcePanoramaMode;
  if (panoramaToggle) panoramaToggle.checked = sourcePanoramaMode;
  if (currentSrc === source || currentSrc?.url === source.url) {
    const previousPresentation = resolvePresentation(source) || {};
    currentSrc = {
      ...source,
      panorama: sourcePanoramaMode,
      presentation: {
        ...previousPresentation,
        mode: sourcePanoramaMode ? "panorama" : "normal",
        projection: previousPresentation.projection || "equirectangular",
        renderer: previousPresentation.renderer || "panoramalite",
        textureFlipX: !!panoramaFlipXToggle?.checked,
        textureFlipY: !!panoramaFlipYToggle?.checked
      },
      textureFlipX: !!panoramaFlipXToggle?.checked,
      textureFlipY: !!panoramaFlipYToggle?.checked
    };
  }
  const host = getPlayerHost();
  if (!useSkin && host) {
    host.querySelectorAll("fyra-ui-shell").forEach((el) => el.remove());
  }
  setNativeControlVisibility();
  const lowerUrl = effectiveSource.url.toLowerCase();
  const wcEnable = !!effectiveSource.webCodecs?.enable || (effectiveSource.type === "file" && lowerUrl.endsWith(".ts"));
  const sourceTexture = resolveTextureFlip(effectiveSource);
  activePanoramaTextureFlipX = sourceTexture.textureFlipX || !!panoramaFlipXToggle?.checked;
  activePanoramaTextureFlipY = sourceTexture.textureFlipY || !!panoramaFlipYToggle?.checked;
  const plugins = [
    ...(useSkin
      ? [
          createUiComponentsPlugin({
            target: ".player-shell"
          })
        ]
      : []),
    createPanoramaLitePlugin({
      target: ".player-shell",
      media: "video",
      enabled: sourcePanoramaMode,
      viewerControls: true,
      crossOrigin: "anonymous",
      powerPreference: "high-performance",
      textureFlipX: activePanoramaTextureFlipX,
      textureFlipY: activePanoramaTextureFlipY,
      onReady: (handle) => {
        panoramaHandle = handle;
        (window as any).fyraPanoramaHandle = handle;
        handle.setEnabled(panoramaMode);
        syncPanoramaModeUi();
      },
      onError: (error) => {
        appendLog(`panoramalite error: ${error instanceof Error ? error.message : String(error)}`);
        syncPanoramaModeUi();
      }
    })
  ];
  plugins.push(createDashTechPlugin());
  syncPanoramaModeUi();
  player = new FyraPlayer({
    video,
    sources: [toPlayerSource(effectiveSource)],
    techOrder: ["gb28181", "webrtc", "ws-raw", "hls", "dash", "fmp4", "file"],
    webCodecs: wcEnable ? { ...(effectiveSource.webCodecs || {}), enable: true } : undefined,
    plugins
  });
  (window as any).fyraPlayer = player;
  bindPlayerEvents(player);
  return player
    .init()
    .catch((e) => {
      setStatus("error", `load failed: ${e?.message || e}`);
      throw e;
    });
}

async function runExclusive(label: string, fn: () => Promise<void> | void) {
  if (busy) {
    appendLog(`busy: ${busy}, skip ${label}`);
    return;
  }
  setBusy(label);
  try {
    await fn();
  } catch (e: any) {
    setStatus("error", `${label} failed: ${e?.message || e}`);
  } finally {
    setBusy(false);
  }
}

function safeRun(label: string, fn: () => Promise<void> | void) {
  operationQueue = operationQueue
    .catch(() => {
      /* keep the demo command queue alive after a failed operation */
    })
    .then(() => runExclusive(label, fn));
  return operationQueue;
}

async function stopPlayback(reason?: string) {
  if (player) {
    try {
      await player.destroy();
    } catch {
      /* ignore */
    }
    player = null;
    (window as any).fyraPlayer = null;
    (window as any).fyraPanoramaHandle = null;
    panoramaHandle = null;
  }
  setPanoramaMode(false, { updateCurrentSource: false });
  setStatus("idle", reason ? `stopped: ${reason}` : "stopped");
}

populateSelect();

select.onchange = () => {
  if (select.value === CUSTOM_VALUE) return;
  const src = presetSources[Number(select.value)];
  if (src) {
    currentSrc = src;
    syncUiWithSource(src);
    safeRun("load", () => createPlayer(src));
  }
};

loadBtn.onclick = () => {
  safeRun("load", () => {
    const url = urlInput.value.trim();
    const type = typeSelect.value as SourceType;
    if (!url && type !== "gb28181") {
      alert("请输入 URL");
      throw new Error("missing url");
    }
    const src: SimpleSource = {
      label: `Custom ${type}`,
      type,
      url,
      panorama: !!panoramaToggle?.checked,
      presentation: {
        mode: panoramaToggle?.checked ? "panorama" : "normal",
        projection: "equirectangular",
        renderer: "panoramalite",
        ...getPanoramaTextureSettings()
      },
      ...getPanoramaTextureSettings()
    };
    if (type === "gb28181") {
      const invite = gbInviteInput?.value.trim() || "";
      if (!invite) {
        alert("GB28181 请输入 Invite URL");
        throw new Error("missing invite url");
      }
      const parsedInvite = parseGbInviteUrl(invite);
      const deviceId = gbDeviceInput?.value.trim() || parsedInvite?.deviceId || "";
      const channelId = gbChannelInput?.value.trim() || parsedInvite?.channelId || "";
      if (!deviceId || !channelId) {
        alert("GB28181 缺少 Device ID / Channel ID（可从 Invite URL 自动提取）");
        throw new Error("missing gb ids");
      }
      if (gbDeviceInput) gbDeviceInput.value = deviceId;
      if (gbChannelInput) gbChannelInput.value = channelId;
      src.gb = {
        invite,
        deviceId,
        channelId,
        streamMode: (gbStreamModeSelect?.value as any) || undefined,
        format: (gbFormatSelect?.value as any) || "flv",
        token: gbTokenInput?.value.trim() || "",
        includeCredentials: !!gbCredsCheckbox?.checked
      };
    }
    currentSrc = src;
    select.value = CUSTOM_VALUE;
    syncUiWithSource(src);
    return createPlayer(src);
  });
};

playBtn.onclick = () => safeRun("play", () => player?.play());
pauseBtn.onclick = () => {
  const isWebrtc = currentSrc?.type === "webrtc" || currentSrc?.type === "webrtc-oven";
  if (busy || uiStatus === "loading" || uiStatus === "buffering" || isWebrtc) {
    void safeRun("stop", () => stopPlayback("manual stop"));
    return;
  }
  safeRun("pause", () => player?.pause());
};

gbInviteInput?.addEventListener("change", syncGbFieldsFromInvite);
gbInviteInput?.addEventListener("blur", syncGbFieldsFromInvite);
gbParseBtn?.addEventListener("click", () => {
  const invite = gbInviteInput?.value.trim() || "";
  if (!invite) {
    alert("请先输入 Invite URL");
    return;
  }
  const result = syncGbFieldsFromInvite();
  if (!result.deviceId || !result.channelId) {
    appendLog("GB invite parse failed: missing device_id/channel_id in URL");
    alert("未能从 Invite URL 自动解析 Device ID / Channel ID，请手动填写");
    return;
  }
  appendLog(`GB invite parsed: device=${result.deviceId}, channel=${result.channelId}`);
});

// 本地文件选择
openFileBtn.onclick = () => fileInput.click();
fileInput.onchange = () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  safeRun("load-file", () => {
    const blobUrl = URL.createObjectURL(file);
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const isTs = ext === 'ts' || ext === 'mts' || ext === 'm2ts';
    const isMp4 = ext === 'mp4' || ext === 'm4v';
    // Determine container type for blob URL hint
    const container = isTs ? 'ts' : (isMp4 ? 'mp4' : undefined);
    // MP4 使用原生播放，TS 使用 mpegts.js
    const src: SimpleSource & { container?: string } = {
      label: `本地: ${file.name}`,
      type: "file",
      url: blobUrl,
      container,
      panorama: !!panoramaToggle?.checked,
      presentation: {
        mode: panoramaToggle?.checked ? "panorama" : "normal",
        projection: "equirectangular",
        renderer: "panoramalite",
        ...getPanoramaTextureSettings()
      },
      ...getPanoramaTextureSettings(),
      webCodecs: undefined // TS blob files use mpegts.js, not WebCodecs
    };
    currentSrc = src;
    select.value = CUSTOM_VALUE;
    urlInput.value = `[本地文件] ${file.name}`;
    typeSelect.value = "file";
    setPanoramaMode(!!src.panorama, { updateCurrentSource: false });
    appendLog(`已选择本地文件: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB), 格式: ${ext.toUpperCase()}`);
    return createPlayer(src);
  });
  // 重置 input 以便再次选择同一文件
  fileInput.value = '';
};
if (skinToggle) {
  skinToggle.checked = useSkin;
  skinToggle.onchange = () => {
    useSkin = skinToggle.checked;
    if (!useSkin) {
      const host = document.querySelector(".player-shell") as HTMLElement | null;
      host?.querySelectorAll("fyra-ui-shell").forEach((el) => el.remove());
      setNativeControlVisibility();
    }
    // Hide demo overlay when skin is enabled (UI shell has its own spinner)
    if (useSkin && overlay) {
      overlay.classList.remove("visible");
    }
    if (currentSrc) {
      safeRun("load", () => createPlayer(currentSrc as SimpleSource));
    }
  };
}
if (nativeToggle) {
  nativeToggle.checked = hideNativeControls;
  nativeToggle.onchange = () => {
    hideNativeControls = nativeToggle.checked;
    setNativeControlVisibility();
  };
}
if (lowLatencyToggle) {
  lowLatencyToggle.checked = false;
  lowLatencyToggle.onchange = () => {
    if (!currentSrc) return;
    const pick = currentSrc.type === "auto" ? detectType(currentSrc.url) : currentSrc.type;
    if (pick !== "hls") return;
    safeRun("load", () => createPlayer(currentSrc as SimpleSource));
  };
}
if (panoramaToggle) {
  panoramaToggle.checked = panoramaMode;
  panoramaToggle.onchange = () => {
    setPanoramaMode(panoramaToggle.checked, {
      updateCurrentSource: true,
      reloadIfTextureChanged: true
    });
  };
}
panoramaResetBtn?.addEventListener("click", () => {
  panoramaHandle?.resetView();
});
for (const input of [panoramaFlipXToggle, panoramaFlipYToggle]) {
  input?.addEventListener("change", () => {
    updateCurrentPanoramaSource(panoramaMode);
    if (panoramaMode && currentSrc) {
      safeRun("load", () => createPlayer(currentSrc as SimpleSource));
      return;
    }
    syncPanoramaModeUi();
  });
}

(window as any).fyraPanorama = {
  getHandle: () => panoramaHandle,
  isEnabled: () => panoramaMode,
  setEnabled: (enabled: boolean) => setPanoramaMode(enabled, { updateCurrentSource: true, reloadIfTextureChanged: true }),
  resetView: () => panoramaHandle?.resetView(),
  getPlugins: () => ({
    ui: useSkin,
    panoramalite: !!panoramaHandle,
    panoramaliteMode: panoramaMode ? "panorama" : "ordinary"
  })
};
syncPanoramaModeUi();

FyraPlayer.probeWebCodecs()
  .then((support) => {
    wcSupport.textContent = `WebCodecs: h264=${support.h264 ? "✔" : "✖"} | h265=${support.h265 ? "✔" : "✖"} | av1=${support.av1 ? "✔" : "✖"} | vp9=${support.vp9 ? "✔" : "✖"}`;
  })
  .catch(() => {
    wcSupport.textContent = "WebCodecs: 未检测到或浏览器不支持";
  });
