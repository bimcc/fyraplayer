import { FyraPlayer } from "../src/index.js";
import defaultSources from "./sources.js";
import { createUiComponentsPlugin } from "../src/plugins/ui-components.js";

type SourceType = "auto" | "hls" | "dash" | "ws-raw" | "file" | "webrtc" | "webrtc-oven" | "gb28181";
type SimpleSource = {
  label: string;
  type: SourceType;
  url: string;
  lowLatency?: boolean;
  webCodecs?: { enable?: boolean };
  gb?: {
    invite?: string;
    deviceId?: string;
    channelId?: string;
    format?: "annexb" | "ts" | "ps";
    video?: "h264" | "h265";
    audio?: "aac" | "pcma" | "pcmu" | "opus";
    webTransport?: boolean;
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
const overlay = document.getElementById("overlay") as HTMLDivElement | null;
const overlayText = document.getElementById("overlay-text") as HTMLDivElement | null;
const gbInviteInput = document.getElementById("gb-invite") as HTMLInputElement | null;
const gbDeviceInput = document.getElementById("gb-device") as HTMLInputElement | null;
const gbChannelInput = document.getElementById("gb-channel") as HTMLInputElement | null;
const gbFormatSelect = document.getElementById("gb-format") as HTMLSelectElement | null;
const gbVideoSelect = document.getElementById("gb-video") as HTMLSelectElement | null;
const gbAudioSelect = document.getElementById("gb-audio") as HTMLSelectElement | null;
const gbWtCheckbox = document.getElementById("gb-wt") as HTMLInputElement | null;
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
  { label: "DASH bbb", type: "dash", url: "https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd" },
  { label: "DASH sintel", type: "dash", url: "https://bitmovin-a.akamaihd.net/content/sintel/sintel.mpd" },
  { label: "MP4 demo", type: "file", url: "https://sf1-cdn-tos.huoshanstatic.com/obj/media-fe/xgplayer_doc_video/mp4/xgplayer-demo-360p.mp4" },
  { label: "TS 本地 (/testvideo/DJI_20250611085647_0001_V.TS)", type: "file", url: "/testvideo/DJI_20250611085647_0001_V.TS", webCodecs: { enable: true } },
  { label: "MP4 本地 (/testvideo/Rec 0017.mp4)", type: "file", url: "/testvideo/Rec%200017.mp4", webCodecs: { enable: true } },
  { label: "FLV demo (ws-raw)", type: "ws-raw", url: "https://sf1-cdn-tos.huoshanstatic.com/obj/media-fe/xgplayer_doc_video/flv/xgplayer-demo-360p.flv" },
  { label: "WebRTC (WHEP localhost:8889/test-webrtc/whep)", type: "webrtc", url: "http://localhost:8889/test-webrtc/whep" }
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
    if (gbFormatSelect) gbFormatSelect.value = src.gb.format || "annexb";
    if (gbVideoSelect) gbVideoSelect.value = src.gb.video || "h264";
    if (gbAudioSelect) gbAudioSelect.value = src.gb.audio || "";
    if (gbWtCheckbox) gbWtCheckbox.checked = !!src.gb.webTransport;
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
  pauseBtn.disabled = disabled;
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

function toPlayerSource(src: SimpleSource): import('../src/types.js').Source {
  const pick = src.type === "auto" ? detectType(src.url) : src.type;
  if (pick === "hls") return { type: "hls" as const, url: src.url, lowLatency: src.lowLatency, preferTech: "hlsdash" as const };
  if (pick === "dash") return { type: "dash" as const, url: src.url, preferTech: "hlsdash" as const };
  if (pick === "ws-raw") return { type: "ws-raw" as const, url: src.url, codec: "h264" as const, transport: "flv" as const, preferTech: "ws-raw" as const };
  if (pick === "gb28181") {
    const gb = src.gb || {};
    return {
      type: "gb28181" as const,
      url: src.url,
      control: { invite: gb.invite || "", bye: gb.invite ? gb.invite.replace("invite", "bye") : "" },
      gb: { deviceId: gb.deviceId || "", channelId: gb.channelId || "" },
      format: gb.format || "annexb",
      codecHints: { video: gb.video, audio: gb.audio },
      webTransport: gb.webTransport
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
    const fatal =
      evt?.fatal ||
      evt?.type === "disconnect" ||
      evt?.type === "ice-failed" ||
      evt?.type === "connect-timeout" ||
      evt?.type === "signal-error" ||
      evt?.type === "offer-timeout" ||
      evt?.type === "ws-fallback-error" ||
      evt?.type === "fatal";
    if (fatal) {
      appendLog("检测到致命网络/信令问题，尝试切换 techOrder 下一候选或重连中...");
      setStatus("loading", "reconnecting...");
    }
  });
  p.on("buffer", () => setStatus("loading", "buffering..."));
  p.on("stats", ({ stats }) => {
    if (!stats) return;
    statsEl.textContent = `bitrate: ${stats.bitrateKbps || "-"} kbps | fps: ${stats.fps || "-"} | res: ${stats.width || "-"}x${stats.height || "-"}`;
  });
}

function createPlayer(source: SimpleSource) {
  if (player) {
    player.destroy().catch(() => {});
    player = null;
  }
  const host = document.querySelector(".player-shell") as HTMLElement | null;
  if (!useSkin && host) {
    host.querySelectorAll("fyra-ui-shell").forEach((el) => el.remove());
  }
  video.controls = !hideNativeControls && !useSkin;
  const lowerUrl = source.url.toLowerCase();
  const wcEnable = !!source.webCodecs?.enable || (source.type === "file" && lowerUrl.endsWith(".ts"));
  player = new FyraPlayer({
    video,
    sources: [toPlayerSource(source)],
    techOrder: ["gb28181", "webrtc", "ws-raw", "hlsdash", "file"],
    webCodecs: wcEnable ? { enable: true } : undefined,
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
    if (!url) {
      alert("请输入 URL");
      throw new Error("missing url");
    }
    const src: SimpleSource = { label: `Custom ${type}`, type, url };
    if (type === "gb28181") {
      src.gb = {
        invite: gbInviteInput?.value.trim() || "",
        deviceId: gbDeviceInput?.value.trim() || "",
        channelId: gbChannelInput?.value.trim() || "",
        format: (gbFormatSelect?.value as any) || "annexb",
        video: (gbVideoSelect?.value as any) || "h264",
        audio: (gbAudioSelect?.value as any) || undefined,
        webTransport: !!gbWtCheckbox?.checked
      };
    }
    currentSrc = src;
    select.value = CUSTOM_VALUE;
    syncUiWithSource(src);
    return createPlayer(src);
  });
};

playBtn.onclick = () => safeRun("play", () => player?.play());
pauseBtn.onclick = () => safeRun("pause", () => player?.pause());

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

FyraPlayer.probeWebCodecs()
  .then((support) => {
    wcSupport.textContent = `WebCodecs: h264=${support.h264 ? "✔" : "✖"} | h265=${support.h265 ? "✔" : "✖"} | av1=${support.av1 ? "✔" : "✖"} | vp9=${support.vp9 ? "✔" : "✖"}`;
  })
  .catch(() => {
    wcSupport.textContent = "WebCodecs: 未检测到或浏览器不支持";
  });
