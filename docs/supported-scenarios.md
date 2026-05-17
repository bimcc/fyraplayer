# FyraPlayer 支持场景与已知限制

> Created: 2026-05-17  
> Purpose: make the commercial baseline explicit so product teams know what can be promised today, what is conditional, and what must stay deferred.

This document is the short answer to "what is FyraPlayer actually ready for?".
For detailed per-browser evidence, use [docs/playback-verification-matrix.md](./playback-verification-matrix.md).

---

## 1. 可对外承诺的基线

These scenarios have code, tests, and repeatable evidence.

| Scenario | Status | Notes |
|---|---|---|
| HLS VOD | Verified | Chrome/Chromium browser evidence exists; `ready`, `play`, `stats`, and seek behavior are documented. |
| DASH VOD | Verified | Chrome/Chromium browser evidence exists; `ready`, `play`, `stats`, and normalized `levelSwitch` payloads are documented. |
| MP4 file playback | Verified | Browser native playback path is stable enough for the current baseline. |
| HTTP-FLV / ws-raw default path | Verified | The commercial/default path is `pipeline: 'mse'`; it uses mpegts.js + browser MSE. |
| Playback lifecycle | Verified | `pause -> play`, `seek`, `switchSource`, and `destroy -> recreate` are covered by unit and Chromium evidence. |
| Observability | Verified | Stable `network.code`, `qos.code`, `stats`, and `levelSwitch` payloads are documented and tested. |
| Performance budget monitoring | Verified contract | Optional plugin samples `stats`, reports budget violations, and emits `PERFORMANCE_BUDGET` QoS warnings; real long-run profiling is still pending. |
| UI/plugin lifecycle | Verified | UI is plugin-only; plugin destroy and third-party Tech registration are covered. |

This is the current commercial baseline. Do not expand the promise beyond this set without a new evidence record.

---

## 2. 带条件支持的场景

| Scenario | Current status | Boundary |
|---|---|---|
| fMP4 direct | Conditional | Queue backpressure and quota cleanup exist, but project-specific browser stream evidence is still pending. |
| WebRTC / MediaMTX | Deferred for backend validation | API and lifecycle contracts exist, but local backend verification is intentionally postponed. |
| GB28181 gateway adapter | Conditional | Player-side invite/control adapter exists for server-side GB gateways. The browser player does not implement SIP/RTP/PS; project-specific backend verification is still pending. |
| ws-raw experimental pipeline | Experimental opt-in | Use only with `pipeline: 'experimental'` or the deprecated compatibility alias. May fall back to MSE. |
| Safari / Edge / Firefox parity | Partial | Record exact browser/version evidence before claiming support beyond Chromium/Chrome. |

---

## 3. 已知限制

- DRM/EME is deferred and should stay pluginized.
- Subtitles/text tracks are deferred and should stay pluginized.
- Ads, SSAI/CSAI, analytics exporters, and business workflow modules are not core responsibilities.
- Long-run memory and listener growth are not yet verified across all browsers and protocols.
- Performance budgets are implemented as warnings and QA signals; they are not yet product-wide optimization proof.
- Unsupported or unverified combinations should be called out explicitly in product docs.

---

## 4. How To Use This

- Use this doc for product-facing support claims.
- Use [docs/playback-verification-matrix.md](./playback-verification-matrix.md) for dated evidence.
- Use [docs/commercial-readiness-roadmap.md](./commercial-readiness-roadmap.md) for task tracking.
- Use [docs/pluginization-map.md](./pluginization-map.md) to decide whether a feature belongs in core or should be optional.
