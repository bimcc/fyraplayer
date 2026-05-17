import { FyraPlayer } from "../src/index.js";
import defaultSources from "./sources.js";
import { createUiComponentsPlugin } from "../src/ui/index.js";

type SourceType = "auto" | "hls" | "dash" | "ws-raw" | "file" | "webrtc" | "webrtc-oven" | "gb28181";
type SimpleSource = {
  label: string;
  type: SourceType;
  url: string;
  lowLatency?: boolean;
  webCodecs?: { enable?: boolean; preferMp4?: boolean; allowH265?: boolean };
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
let uiStatus: "idle" | "loading" | "ready" | "playing" | "paused" | "ended" | "error" | "buffering" = "idle";
let currentSrc: SimpleSource | null = null;
let useSkin = true;
let hideNativeControls = false;
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
  { label: "MediaMTX HLS local (live/test)", type: "hls", url: "http://127.0.0.1:8888/live/test/index.m3u8", lowLatency: false },
  { label: "MediaMTX WebRTC WHEP local (live/test)", type: "webrtc", url: "http://127.0.0.1:8889/live/test/whep" },
  { label: "DASH bbb", type: "dash", url: "https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd" },
  { label: "DASH sintel", type: "dash", url: "https://bitmovin-a.akamaihd.net/content/sintel/sintel.mpd" },
  { label: "MP4 demo", type: "file", url: "https://sf1-cdn-tos.huoshanstatic.com/obj/media-fe/xgplayer_doc_video/mp4/xgplayer-demo-360p.mp4" },
  { label: "TS 本地 (/testvideo/DJI_20250611085647_0001_V.TS)", type: "file", url: "/testvideo/DJI_20250611085647_0001_V.TS", webCodecs: { enable: true, preferMp4: false } },
  { label: "MP4 本地 (/testvideo/Rec 0017.mp4)", type: "file", url: "/testvideo/Rec%200017.mp4", webCodecs: { enable: true, preferMp4: true } },
  { label: "FLV demo (ws-raw)", type: "ws-raw", url: "https://sf1-cdn-tos.huoshanstatic.com/obj/media-fe/xgplayer_doc_video/flv/xgplayer-demo-360p.flv" }
];

defaultSources?.forEach((s: any, idx: number) => {
  presetSources.push({
    label: `Default ${idx} - ${s.type}`,
    type: s.type,
    url: s.url,
    lowLatency: (s as any).lowLatency,
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
    opt.textContent = s.label;
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
}

function setBusy(flag: string | false, message?: string) {
  busy = flag;
  // When skin is enabled, the UI shell has its own spinner, so hide the demo overlay
  if (overlay && overlayText) {
    if (flag && !useSkin) {
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

function applyLowLatencyToggle(src: SimpleSource): SimpleSource {
  if (!lowLatencyToggle) return src;
  const pick = src.type === "auto" ? detectType(src.url) : src.type;
  if (pick !== "hls") return src;
  if (src.lowLatency === lowLatencyToggle.checked) return src;
  return { ...src, lowLatency: lowLatencyToggle.checked };
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
  if (pick === "hls") return { type: "hls" as const, url: src.url, lowLatency: src.lowLatency, preferTech: "hls" as const };
  if (pick === "dash") return { type: "dash" as const, url: src.url, preferTech: "dash" as const };
  if (pick === "ws-raw") return { type: "ws-raw" as const, url: src.url, codec: "h264" as const, transport: "flv" as const, preferTech: "ws-raw" as const };
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
      format: gb.format || "flv"
    };
  }
  if (pick === "webrtc-oven" || pick === "webrtc") {
    // WebRTC source - tech-webrtc 会自动检测 wss:// URL 并使用 oven-ws 信令
    // 对于 http(s):// URL，会自动使用 WHEP 信令
    return { type: "webrtc" as const, url: src.url, preferTech: "webrtc" as const };
  }
  // File source - include container hint for blob URLs
  return { 
    type: "file" as const, 
    url: src.url, 
    preferTech: "file" as const, 
    webCodecs: src.webCodecs,
    container: (src as any).container as 'ts' | 'mp4' | undefined
  };
}

function detectType(url: string): Exclude<SourceType, "auto"> {
  const lower = url.toLowerCase();
  if (lower.endsWith(".m3u8")) return "hls";
  if (lower.endsWith(".mpd")) return "dash";
  if (lower.endsWith(".flv")) return "ws-raw";
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
    if (evt?.code || evt?.type) {
      const code = evt?.code || evt?.type || "qos";
      appendLog(`qos[${code}]: ${JSON.stringify(evt)}`);
    }
  });
  p.on("buffer", () => setStatus("loading", "buffering..."));
  p.on("stats", ({ stats }) => {
    if (!stats) return;
    statsEl.textContent = `bitrate: ${stats.bitrateKbps || "-"} kbps | fps: ${stats.fps || "-"} | res: ${stats.width || "-"}x${stats.height || "-"}`;
  });
}

async function createPlayer(source: SimpleSource) {
  if (player) {
    const previous = player;
    player = null;
    (window as any).fyraPlayer = null;
    await previous.destroy().catch(() => {});
  }
  const effectiveSource = applyLowLatencyToggle(source);
  const host = document.querySelector(".player-shell") as HTMLElement | null;
  if (!useSkin && host) {
    host.querySelectorAll("fyra-ui-shell").forEach((el) => el.remove());
  }
  video.controls = !hideNativeControls && !useSkin;
  const lowerUrl = effectiveSource.url.toLowerCase();
  const wcEnable = !!effectiveSource.webCodecs?.enable || (effectiveSource.type === "file" && lowerUrl.endsWith(".ts"));
  player = new FyraPlayer({
    video,
    sources: [toPlayerSource(effectiveSource)],
    techOrder: ["gb28181", "webrtc", "ws-raw", "hls", "dash", "fmp4", "file"],
    webCodecs: wcEnable ? { ...(effectiveSource.webCodecs || {}), enable: true } : undefined,
    plugins: useSkin
      ? [
          createUiComponentsPlugin({
            target: ".player-shell"
          })
        ]
      : []
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

async function safeRun(label: string, fn: () => Promise<void> | void) {
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

async function stopPlayback(reason?: string) {
  if (player) {
    try {
      await player.destroy();
    } catch {
      /* ignore */
    }
    player = null;
    (window as any).fyraPlayer = null;
  }
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
    const src: SimpleSource = { label: `Custom ${type}`, type, url };
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
    void stopPlayback("manual stop");
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
      webCodecs: undefined // TS blob files use mpegts.js, not WebCodecs
    };
    currentSrc = src;
    select.value = CUSTOM_VALUE;
    urlInput.value = `[本地文件] ${file.name}`;
    typeSelect.value = "file";
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
      video.controls = !hideNativeControls;
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
    video.controls = !hideNativeControls && !useSkin;
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

FyraPlayer.probeWebCodecs()
  .then((support) => {
    wcSupport.textContent = `WebCodecs: h264=${support.h264 ? "✔" : "✖"} | h265=${support.h265 ? "✔" : "✖"} | av1=${support.av1 ? "✔" : "✖"} | vp9=${support.vp9 ? "✔" : "✖"}`;
  })
  .catch(() => {
    wcSupport.textContent = "WebCodecs: 未检测到或浏览器不支持";
  });
