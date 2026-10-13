# SRS (Simple Realtime Server) Docker 部署与 WebRTC 避坑指南

本文档总结了基于 Docker 部署 SRS 并启用 WebRTC (WHEP) 播放的最佳实践。重点解决了目录规划、端口映射、防火墙冲突以及黑屏转圈等常见问题。

---

## 0. ⚠️ 环境准备与目录避坑 (非常重要)

在开始之前，请务必选择正确的部署目录。

### ❌ 严禁使用的目录

- **Web 根目录 (如 `/var/www/html`、`/www/wwwroot`)**：
  - **原因 1 (安全)**：如果 Nginx 配置不当，您的配置文件 (`srs.conf`, `docker-compose.yml`) 可能会被直接下载，导致密码或架构泄露。
  - **原因 2 (权限)**：Web 目录通常属于 `www-data` 或 `www` 用户，而 Docker 容器挂载往往需要 root 权限或特定的 UID/GID，容易导致容器启动失败或文件不可写。

### ✅ 推荐的目录结构

建议在 `/opt`、`/data` 或 `root` 家目录下创建独立文件夹。

**操作示例**：

```bash
# 1. 创建项目目录 (推荐)
mkdir -p /dockerconf/srs
cd /dockerconf/srs

# 2. 创建配置子目录
mkdir -p conf
mkdir -p objs

# 3. 创建空配置文件 (防止挂载时被 Docker 识别为目录)
touch conf/srs.conf
touch docker-compose.yml
```

**最终目录结构应如下**：

```text
/dockerconf/srs/
├── docker-compose.yml
├── conf/
│   └── srs.conf
└── objs/      (可选，用于存放日志或静态文件)
```

---

## 1. 核心原则：端口必须"内外一致"

对于 **HTTP/RTMP (TCP)** 协议，端口可以不一致（如 `8083:8080`），Docker 会自动转发。
但对于 **WebRTC (UDP)** 协议，**宿主机端口、容器端口、SRS 配置文件端口必须三者完全一致**。

> **为什么？**
> WebRTC 使用 SDP 协议进行"带外协商"。服务器会在 SDP 中告诉客户端："请往端口 X 发送数据"。如果 Docker 映射成了端口 Y，客户端依然只会往 X 发，导致连接失败（黑屏）。

---

## 2. 推荐的 Docker Compose 编排

建议将所有端口（尤其是 UDP）保持原样或统一修改，不要做不一致的映射。

**文件：`docker-compose.yml`**

```yaml
version: "3"
services:
  srs:
    container_name: srs6
    image: ossrs/srs:latest
    restart: always
    ports:
      # [TCP] RTMP 推流端口
      - "1935:1935"
      # [TCP] HTTP API 端口 (WebRTC 信令/控制台)
      - "1985:1985"
      # [TCP] HTTP Server 端口 (FLV/HLS 拉流)
      - "8080:8080"
      # [UDP] WebRTC 媒体传输端口 (关键！必须内外一致)
      # 如果 8000 被占用，请统一改为 8003 (宿主机:容器)
      - "8003:8003/udp"
      - "8003:8003/tcp"
    volumes:
      # 挂载宿主机的配置文件到容器内部
      # 宿主机路径 : 容器内路径
      - ./conf/srs.conf:/usr/local/srs/conf/docker.conf
      # (可选) 挂载日志目录
      # - ./objs:/usr/local/srs/objs
    # 指定启动时加载该配置文件
    command: ["./objs/srs", "-c", "conf/docker.conf"]
```

---

## 3. SRS 配置文件编写

确保 `listen` 端口与 Docker 映射的端口一致。

**文件：`conf/srs.conf`** (注意是在 conf 子目录下)

```nginx
listen              1935;
max_connections     1000;
daemon              off;
srs_log_tank        console;

# HTTP API (WHEP 信令接口)
http_api {
    enabled         on;
    listen          1985; # 对应 Docker 的 1985
}

# HTTP Server (FLV/HLS 流媒体服务)
http_server {
    enabled         on;
    listen          8080; # 对应 Docker 的 8080
}

# WebRTC Server (核心配置)
rtc_server {
    enabled on;
    # [关键] 这里必须与 Docker 映射的外部端口一致！
    # 如果 Docker 是 8003:8003，这里就填 8003
    listen 8003;

    # 自动获取宿主机 IP 填充到 SDP 中
    candidate $CANDIDATE;
}

vhost __defaultVhost__ {
    hls {
        enabled on;
    }
    http_remux {
        enabled on;
        mount [vhost]/[app]/[stream].flv;
    }
    rtc {
        enabled on;
        rtmp_to_rtc on;
        rtc_to_rtmp on;
    }
}
```

---

## 4. 常见问题与排查 (Troubleshooting)

### 现象 A：WebRTC 播放报错 404 (Not Found)

- **原因**：找错门了。你访问的是 HTTP Server 端口（如 8080/8083），但 WHEP 信令接口在 API 端口（如 1985）。
- **解决**：修改播放器 URL 端口为 `http_api` 的端口。
  - ❌ 错误：`http://ip:8083/rtc/v1/whep/...`
  - ✅ 正确：`http://ip:1985/rtc/v1/whep/...`

### 现象 B：不报错，但画面一直转圈黑屏 (UDP 不通)

- **原因 1：端口映射不一致**。
  - 检查：Docker 映射是否为 `8003:8000`？如果是，请改为 `8003:8003` 并修改 `srs.conf` 监听 8003。
- **原因 2：防火墙拦截**。
  - 检查：云服务器安全组是否放行了 **UDP 协议** 的 8003 端口？
  - 检查：服务器内部 `firewalld` 是否拦截了？
- **原因 3：Docker 网络规则失效**。
  - 场景：当你重启过防火墙 (`systemctl restart firewalld`)，Docker 建立的路由表会被清除。
  - **解决**：不要只重启容器！**必须删除并重建容器**，或者重启整个 Docker 服务 (`systemctl restart docker`)。

---

## 5. 重启与生效机制总结

| 你的操作                              | 影响范围         | 适用场景                                                                       |
| :------------------------------------ | :--------------- | :----------------------------------------------------------------------------- |
| **修改宿主机 srs.conf**               | **不会立即生效** | 需要重启容器才能生效。                                                         |
| **重启容器 (`docker restart`)**       | **加载新配置**   | 适用于只改了配置文件，没改端口映射。                                           |
| **重建容器 (`docker-compose up -d`)** | **重建网络规则** | 适用于**修改了端口映射**，或**防火墙干扰**导致网络不通时。推荐优先使用此方法。 |
| **重启 Docker 服务**                  | **最彻底**       | 当所有手段都无效，怀疑 iptables 乱掉时使用。                                   |

## 6. 标准化操作流程 (SOP)

1.  **准备**：
    - 进入目录：`cd /dockerconf/srs`
    - 修改配置：`vim conf/srs.conf` (WebRTC 端口改 8003)
    - 修改编排：`vim docker-compose.yml` (端口映射 8003:8003/udp)
2.  **清理环境**：
    ```bash
    # 停止并删除旧容器
    docker-compose down
    # (如果不需要防火墙) 确保防火墙关闭，避免干扰 Docker
    systemctl stop firewalld
    ```
3.  **启动服务**：
    ```bash
    docker-compose up -d
    ```
4.  **验证**：
    - 访问 HLS 确认流存在：`http://ip:8080/live/livestream.m3u8`
    - 访问 WebRTC 播放 (注意用 API 端口)：`http://ip:1985/rtc/v1/whep/...`
