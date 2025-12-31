# KLV 元数据集成指南

本文档描述如何在 FyraPlayer 中集成 KLV (Key-Length-Value) 元数据提取功能，支持 MISB 0601 等标准的实时解析。

## 概述

FyraPlayer 支持从 MPEG-TS 流中提取两种类型的元数据：

1. **私有数据流 (Private Data)** - 包括 KLV、SMPTE 等封装在 PES 私有流中的数据
2. **SEI NAL 单元** - H.264/H.265 视频流中的补充增强信息

## 配置元数据提取

### 基本配置

在 `WSRawSource` 中启用元数据提取：

```typescript
const player = new FyraPlayer({
  sources: [{
    type: 'ws-raw',
    url: 'wss://example.com/live.ts',
    codec: 'h264',
    transport: 'ts',  // 必须为 'ts'
    experimental: true,
    metadata: {
      privateData: {
        enable: true,
        // pids: [0x0102]  // 可选：手动指定 PID，否则自动检测
      },
      sei: {
        enable: true
      }
    }
  }],
  // ...其他配置
});
```

### 配置说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `metadata.privateData.enable` | boolean | 启用私有数据流提取 |
| `metadata.privateData.pids` | number[] | 手动指定 PID 列表，不指定则自动从 PMT 检测 |
| `metadata.sei.enable` | boolean | 启用 SEI NAL 单元提取 |

**重要限制**：元数据提取仅支持 `transport: 'ts'` 的源。

## 监听元数据事件

### 事件结构

```typescript
interface MetadataEvent {
  type: 'private-data' | 'sei';
  raw: Uint8Array;      // 原始字节数据
  pts: number;          // 显示时间戳 (毫秒)
  pid?: number;         // 私有数据的 PID (仅 type='private-data')
  seiType?: number;     // SEI 负载类型 (仅 type='sei')
}
```

### 注册事件监听

```typescript
player.on('metadata', (event: MetadataEvent) => {
  if (event.type === 'private-data') {
    console.log(`Private data from PID ${event.pid} at PTS ${event.pts}ms`);
    // 处理 KLV 数据
    processKlvData(event.raw, event.pts);
  } else if (event.type === 'sei') {
    console.log(`SEI type ${event.seiType} at PTS ${event.pts}ms`);
    // 处理 SEI 数据
    processSeiData(event.raw, event.seiType, event.pts);
  }
});
```

## 集成 @beeviz/klv 解析器

### 安装

```bash
npm install @beeviz/klv
```

### 实时流解析示例

```typescript
import { FyraPlayer } from 'fyraplayer';
import { KlvParser, Misb0601 } from '@beeviz/klv';

const player = new FyraPlayer({
  sources: [{
    type: 'ws-raw',
    url: 'wss://example.com/live.ts',
    codec: 'h264',
    transport: 'ts',
    experimental: true,
    metadata: {
      privateData: { enable: true }
    }
  }],
  video: '#player'
});

// 创建 KLV 解析器
const klvParser = new KlvParser();

// 监听元数据事件
player.on('metadata', (event) => {
  if (event.type !== 'private-data') return;
  
  try {
    // 解析 KLV 数据
    const klvPackets = klvParser.parse(event.raw);
    
    for (const packet of klvPackets) {
      // 检查是否为 MISB 0601 数据
      if (Misb0601.isValidKey(packet.key)) {
        const decoded = Misb0601.decode(packet.value);
        
        // 处理解码后的元数据
        handleMisb0601Data(decoded, event.pts);
      }
    }
  } catch (err) {
    console.warn('KLV parse error:', err);
  }
});

function handleMisb0601Data(data: Misb0601Data, pts: number) {
  // 示例：提取传感器位置
  if (data.sensorLatitude && data.sensorLongitude) {
    updateSensorPosition({
      lat: data.sensorLatitude,
      lng: data.sensorLongitude,
      alt: data.sensorAltitude,
      timestamp: pts
    });
  }
  
  // 示例：提取目标位置
  if (data.targetLatitude && data.targetLongitude) {
    updateTargetPosition({
      lat: data.targetLatitude,
      lng: data.targetLongitude,
      timestamp: pts
    });
  }
}
```

### 离线文件解析示例

对于已录制的 TS 文件，可以使用 Demuxer 直接解析：

```typescript
import { Demuxer, DemuxerCallbacks } from 'fyraplayer/techs/wsRaw/demuxer';
import { KlvParser, Misb0601 } from '@beeviz/klv';

async function parseOfflineFile(fileBuffer: ArrayBuffer) {
  const klvParser = new KlvParser();
  const results: { pts: number; data: Misb0601Data }[] = [];
  
  const callbacks: DemuxerCallbacks = {
    onPrivateData: (pid, data, pts) => {
      try {
        const packets = klvParser.parse(data);
        for (const packet of packets) {
          if (Misb0601.isValidKey(packet.key)) {
            const decoded = Misb0601.decode(packet.value);
            results.push({ pts, data: decoded });
          }
        }
      } catch (err) {
        console.warn(`KLV parse error at PTS ${pts}:`, err);
      }
    }
  };
  
  const demuxer = new Demuxer({
    format: 'ts',
    callbacks
  });
  
  // 分块处理文件
  const chunkSize = 188 * 100; // 100 个 TS 包
  for (let offset = 0; offset < fileBuffer.byteLength; offset += chunkSize) {
    const chunk = fileBuffer.slice(offset, offset + chunkSize);
    demuxer.demux(chunk);
  }
  
  return results;
}
```

## SEI 数据处理

### 常见 SEI 类型

| 类型值 | 名称 | 说明 |
|--------|------|------|
| 0 | Buffering Period | 缓冲周期信息 |
| 1 | Picture Timing | 图像时序信息 |
| 4 | User Data Registered | 注册用户数据 (ITU-T T.35) |
| 5 | User Data Unregistered | 未注册用户数据 (UUID) |
| 6 | Recovery Point | 恢复点信息 |

### SEI 处理示例

```typescript
player.on('metadata', (event) => {
  if (event.type !== 'sei') return;
  
  switch (event.seiType) {
    case 5: // User Data Unregistered
      // 前 16 字节为 UUID
      const uuid = event.raw.subarray(0, 16);
      const payload = event.raw.subarray(16);
      handleUnregisteredUserData(uuid, payload, event.pts);
      break;
      
    case 4: // User Data Registered (ITU-T T.35)
      handleRegisteredUserData(event.raw, event.pts);
      break;
      
    default:
      console.log(`Unhandled SEI type ${event.seiType}`);
  }
});
```

## 事件排序

元数据事件按 PTS (显示时间戳) 排序后发送，确保：

1. 同一 demux 周期内的事件按正确的时间顺序发送
2. 私有数据和 SEI 事件混合时也保持正确顺序
3. 便于与视频帧同步处理

## 性能考虑

1. **回调效率**：元数据回调在主线程执行，避免在回调中进行耗时操作
2. **数据拷贝**：`event.raw` 是原始缓冲区的视图，如需保存请使用 `event.raw.slice()`
3. **错误处理**：回调中的错误会被捕获并记录，不会中断流处理

## 故障排除

### 未收到元数据事件

1. 确认 `transport: 'ts'` 已设置
2. 确认 `metadata.privateData.enable` 或 `metadata.sei.enable` 为 true
3. 检查流是否包含私有数据 PID (stream_type 0x06 或 0x15)
4. 使用 `ffprobe` 检查流结构：
   ```bash
   ffprobe -show_streams input.ts
   ```

### PID 未被检测

如果自动检测未找到正确的 PID，可以手动指定：

```typescript
metadata: {
  privateData: {
    enable: true,
    pids: [0x0102, 0x0103]  // 手动指定 PID
  }
}
```

## 相关资源

- [MISB ST 0601 标准](https://nsgreg.nga.mil/misb.jsp)
- [@beeviz/klv 文档](https://github.com/beeviz/klv)
- [H.264 SEI 规范 (ITU-T H.264)](https://www.itu.int/rec/T-REC-H.264)
