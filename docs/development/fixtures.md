# 本地开发与 fixture

从仓库根目录运行 `pnpm install --frozen-lockfile`、`pnpm dev`，访问 basic.html 或 panoramalite.html。源清单以 [examples/sources.js](../../examples/sources.js) 为准，不再双维护 testmedia。

## MediaMTX / SRS

MediaMTX 文件放在 [checks/fixtures/mediamtx](../../checks/fixtures/mediamtx/docker-compose.yml)，compose 中的配置挂载相对于该目录解析：

```sh
docker compose -f checks/fixtures/mediamtx/docker-compose.yml up -d
docker compose -f checks/fixtures/mediamtx/docker-compose.yml down
```

这是保留的本地开发模板，本轮未启动 Docker 验证。它沿用 latest-ffmpeg 镜像；复现历史测试或部署前应固定实际镜像版本，并核对该版本 WebRTC ICE 配置字段。它不是生产部署方案。

SRS 的历史部署步骤整理在 [srs.md](srs.md)，其中服务地址和机器路径需要按环境替换。不要将公网示例地址在线作为自动化发布条件。

## 可重复检查

- `pnpm serve:fmp4-fixture`：本机 ffmpeg 的 fMP4 服务，选项见 [脚本](../../checks/ffmpeg-fmp4-fixture.mjs)。
- `pnpm long-run:browser --help`：真实浏览器长跑，随后用 `pnpm long-run:assert` 检查结果。
- `pnpm smoke:panoramalite --help`：全景图片/视频 smoke。
- `node checks/browser-package-smoke.mjs [本地MP4路径]`：先构建示例站点，再在 Edge 验证已打包 IIFE 的视频帧推进、UI/插件清理和会话 epoch；默认使用 examples/testvideo/Rec 0017.mp4。可设置 FYRA_SMOKE_OUTPUT 保存到指定报告路径、FYRA_SMOKE_CDP_PORT 避开占用端口。发布验收设置 FYRA_SMOKE_PACKAGE 指向冻结的 tgz，检查将使用其中的 IIFE 并记录包摘要。
- `node checks/fyraklv-consumer.mjs [fyraklv项目路径]`：用已构建的独立 fyraklv 验证真实解析、显式时钟查询和清理；默认查找相邻仓库，不属于 CI 必选项。
- Jest 的 TS/FLV/SEI 二进制 fixture 在测试内生成，验证分片、长度、截断与原始 PTS，无需下载媒体。
- `node checks/browser-playback-health-smoke.mjs`：先 build:release，验证原生首帧、真实 captureStream 停止/恢复出帧、暂停/应用挂起排除和清理。FYRA_SMOKE_OUTPUT/FYRA_SMOKE_CDP_PORT 可另存报告/更换端口。
- `node checks/browser-controls-smoke.mjs`：先 bundle:examples，验证错误地址取消、画质隐藏/resize、实际循环播放、原生视频全景 CORS 检查与控制栏。FYRA_CONTROLS_OUTPUT 可保留不同轮次证据。
- `node checks/browser-mobile-smoke.mjs`：验证移动模拟的触摸、窄屏菜单、全景/全屏与无版本参数的 WebTransport 配置；不能替代真机 iOS/Android 测试。
- `node checks/browser-multiview-smoke.mjs`：先 bundle:examples，验证四路真实 MP4、活动/启动上限、独立快捷键、离屏/后台释放与返回、错误隔离和移动滚动；FYRA_MULTIVIEW_URL/FYRA_MULTIVIEW_OUTPUT 可指定开发页/新报告。

examples/testvideo 仍被浏览器验证使用，保留；ref 是被忽略的参考仓库，不参与构建；.fyra-long-run 包含运行报告、日志和历史证据，不应整目录删除。

## 多路示例的可选 HLS 验证

在新的证据目录中生成短 H.264 VOD，再设置 FYRA_MULTIVIEW_HLS_DIR；已有目录请使用新的名字，保留历史证据。下面从仓库根目录运行，要求 ffmpeg 在 PATH。

```powershell
New-Item -ItemType Directory -Path .fyra-long-run/multiview-hls-new
ffmpeg -hide_banner -loglevel error -i 'examples/testvideo/Rec 0017.mp4' -t 6 -an -vf scale=480:-2 -c:v libx264 -preset ultrafast -g 25 -bf 0 -hls_time 1 -hls_list_size 0 -hls_playlist_type vod -f hls .fyra-long-run/multiview-hls-new/index.m3u8
$env:FYRA_MULTIVIEW_HLS_DIR='.fyra-long-run/multiview-hls-new'
$env:FYRA_MULTIVIEW_OUTPUT='.fyra-long-run/multiview-new'
node checks/browser-multiview-smoke.mjs
```

该可选路径额外验证真实 HLS ready、视频帧和单路工具栏停止；未设置目录时只验证 MP4 正向播放及 HLS 403 错误隔离，不声称 HLS 正向验收。

## WebTransport / HTTP/3

可选本地验证，不加入 SDK 运行依赖或通用 CI 门禁。需要 Python >=3.12、ffmpeg、Edge 与可用的 UDP 18443；以下为仓库根目录 PowerShell 命令，ffmpeg 也可传绝对路径。

```powershell
python -m venv .fyra-long-run/webtransport-venv
.fyra-long-run/webtransport-venv/Scripts/python.exe -m pip install aioquic==1.3.0
pnpm build:release
.fyra-long-run/webtransport-venv/Scripts/python.exe checks/fixtures/webtransport-video.py --output .fyra-long-run/wt-fixture --ffmpeg ffmpeg
```

保持 fixture 运行，在另一个终端执行 `node checks/browser-webtransport-smoke.mjs`。参数可依次指定 ready.json 与备用 MP4 路径。fixture 只监听 127.0.0.1，生成两天有效的 P-256 证书、测试视频与哈希；客户端显式固定该证书，没有关闭浏览器 TLS 校验。不要把私钥/哈希写入产品配置。停止 fixture 用 Ctrl+C，测试浏览器/profile 由 runner 清理。

可选 KLV 真解析检查：先构建相邻 fyraklv，设置 `$env:FYRA_KLV_PROJECT='G:/YT/beevizproject/fyraklv'` 后运行同一个 runner。它临时捆绑应用组合示例与外部 KLVStreamManager，不写入 SDK dist。fixture 的 /metadata 在同一可靠流中交错完整 MISB KLV 与 H.264，KLV 纬度值随帧变化；原始时钟 5000017us，2 秒后新配置重启为 1000017us。验证每个 canvas 帧查询对应的 90kHz 状态及纬度标记、配置间隙返回 null/空缓冲、暂停和停止；报告 metadata 字段保存证据。未设置该变量时仍运行纯视频和有元数据但未安装 KLV 插件的出帧/清理检查，不做 MISB 语义解析。

报告 `.fyra-long-run/webtransport-browser.json` 记录真实原生 HTTP/3、H.264、HEVC 配置与实际解码结果、暂停恢复、首帧挂起取消和显式 MP4 回退。H.264 或资源断言失败会使 runner 非零退出；HEVC 是条件路径，报告配置探测、实际解码状态和失败原因，不能仅依据 runner 通过宣称 HEVC 可用。协议限制见 [WebTransport](../webtransport.md)。

Windows fixture 使用 SelectorEventLoop，以保持浏览器关闭后 UDP 收包可继续工作；默认 Proactor 在此环境出现过 ICMP 后不再接收后续连接的现象。该修正只作用于 Python 测试服务，不改变播放器协议。每次重启 fixture 会重新生成证书，因此重新读取 ready.json；浏览器 runner 启动期限采用插件默认 15 秒。


### WebTransport 突发输入与多路回归

设置 `$env:FYRA_WT_STRESS='1'` 后运行同一浏览器 runner，会额外消费 `/burst` 与 `/hevc-burst`（需重启最新 Python fixture），以 maxDecodeQueue=2 接收前 40 帧无间隔发送的真实 H.264/HEVC，然后恢复 20fps；另开四个 Player 同时启动，设备支持时为两路 H.264 + 两路 HEVC，否则四路 H.264。检查首个关键帧原始时钟、持续出帧、停止后 track 结束及迟到帧为零。此模式不注入解码成功；HEVC 配置支持但未出帧会在报告保存后使 runner 非零退出。

设置 FYRA_SMOKE_PACKAGE 可直接使用已冻结 tarball 内的 IIFE，报告记录其 SHA-256；可选 fyraklv 适配器仍由应用示例临时构建，未加入 SDK 包。

这是 320×200、本机 HTTP/3 的功能与突发回归，不是多路容量、p95、弱网或硬解认证。通过 FYRA_SMOKE_OUTPUT 为每次运行指定新报告名，保留失败证据；真实设备码流仍需独立验证。
