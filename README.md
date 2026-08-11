# Windows 局域网调试工具集

一个以 Node.js 为核心的 Windows 本地工具仓库，包含 HTTP/HTTPS 调试代理、实时聊天室和局域网文件共享服务。三项服务相互独立，可以按需启动。

> 本项目面向本机或可信局域网调试。聊天室和文件共享服务不应直接暴露到公网。

## 服务一览

| 服务 | 默认地址 | 主要用途 | 技术栈 |
| --- | --- | --- | --- |
| HTTP 调试服务器 | `http://127.0.0.1:5050` | 静态文件、请求回显、CORS、API 代理、自签 HTTPS | Node.js |
| 局域网聊天室 | `http://127.0.0.1:8091` | 公共聊天、单聊、文字与图片消息、历史记录 | Node.js、SQLite、WebSocket、Vue 3 |
| 文件共享服务器 | `http://127.0.0.1:8090` | 局域网上传、浏览、下载和删除文件 | Node.js |

## 环境要求

- Windows 10/11；
- Node.js 22，推荐 `22.22.0` 或更高的 Node 22 版本；
- 聊天室前端需要 pnpm；
- 只有聊天室需要安装 npm/pnpm 依赖，另外两项服务只使用 Node.js 内置模块。

你可以安装系统 Node.js，也可以自行将 (Node.js)[https://nodejs.org/zh-cn/download/archive/v22.22.0] 解压到项目根目录 放在仓库根目录。三个启动脚本会优先使用 `DEBUG_NODE_EXE`，然后查找仓库中的便携 Node，最后使用系统 `PATH` 中的 `node`。

## 快速开始

### 1. 克隆与安装聊天室依赖

```powershell
git clone <你的仓库地址>
Set-Location <仓库目录>

npm --prefix ".\Chat room server" install
corepack enable
pnpm --dir ".\Chat room server\frontend" install
```

如果希望显式指定 Node.js：

```powershell
$env:DEBUG_NODE_EXE = "C:\Program Files\nodejs\node.exe"
```

### 2. 启动所需服务

```powershell
# HTTP/HTTPS 调试服务器
& ".\HTTP debug server\start-server.cmd"

# 局域网聊天室（启动前会自动构建 Vue 前端）
& ".\Chat room server\start-chat.cmd"

# 文件共享服务器
& ".\File sharing server\启动文件共享服务.cmd"
```

访问局域网服务时，将 `127.0.0.1` 替换为服务端电脑的 IPv4 地址。可使用 `ipconfig` 查看 IPv4；其他设备无法连接时，请检查 Windows 防火墙是否允许对应端口。

## 目录结构

```text
server/
├─ HTTP debug server/
│  ├─ server.js                 # HTTP/HTTPS、静态文件和代理实现
│  ├─ start-server.cmd          # 启动及环境变量配置入口
│  ├─ public/                   # 静态文件根目录
│  └─ cert/README.md            # 本地证书放置说明
│
├─ Chat room server/
│  ├─ server.js                 # HTTP、WebSocket、消息写入入口
│  ├─ identity-service.js       # 用户、token 和用户搜索
│  ├─ conversation-service.js   # 会话、成员、历史、未读和撤回
│  ├─ image-storage.js          # 图片校验、哈希和本地存储
│  ├─ config.js                 # 聊天室集中配置
│  ├─ start-chat.cmd            # 构建前端并启动聊天室
│  ├─ frontend/                 # Vue 3 + Vite + pnpm 前端
│  └─ data/                     # 数据库和图片，运行时生成且不会提交
│
├─ File sharing server/
│  ├─ server.js                 # 上传、下载、列表和删除接口
│  ├─ index.html                # 文件管理页面
│  ├─ bg.png                    # 页面背景
│  ├─ 启动文件共享服务.cmd       # 推荐启动入口
│  ├─ uploads/                  # 共享文件，运行时生成且不会提交
│  └─ log/                      # 运行日志，不会提交
│
├─ .gitignore
└─ README.md
```

## HTTP/HTTPS 调试服务器

### 功能

- 托管 `HTTP debug server/public` 中的静态文件；
- 为 SPA 路由回退到 `public/index.html`；
- 输出请求日志和有限长度的请求体预览；
- 处理 CORS 和预检请求；
- 将指定路径前缀代理到 HTTP/HTTPS 上游；
- 提供 Health 和 Echo 调试接口；
- 可使用本地 PEM 私钥与证书启用 HTTPS。

请求处理顺序：

```text
请求日志
  → CORS 预检
  → /__debug/* 调试接口
  → 匹配前缀的 API 代理
  → public 静态文件
  → public/index.html SPA 回退
```

### 调试接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/__debug/health` | 返回协议、Node 版本、进程、静态目录和代理目标 |
| 任意 | `/__debug/echo` | 回显请求方法、查询参数、请求头和请求体 |

```powershell
Invoke-RestMethod "http://127.0.0.1:5050/__debug/health"

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:5050/__debug/echo?from=readme" `
  -ContentType "application/json" `
  -Body '{"hello":"world"}'
```

### API 代理

```powershell
$env:DEBUG_PROXY_TARGET = "http://127.0.0.1:8080"
$env:DEBUG_PROXY_PREFIX = "/api/"
& ".\HTTP debug server\start-server.cmd"
```

请求方法、请求体、路径和查询字符串都会保留。`/api/users?page=1` 会转发为上游的 `/api/users?page=1`，不会自动移除 `/api`。

### HTTPS 与自签证书

将 PEM 文件放到：

```text
HTTP debug server/cert/server-key.pem
HTTP debug server/cert/server-cert.pem
```

然后启动：

```powershell
$env:DEBUG_SERVER_HTTPS = "true"
& ".\HTTP debug server\start-server.cmd"
```

默认 HTTPS 地址为 `https://127.0.0.1:8443`。也可以使用仓库外的证书：

```powershell
$env:DEBUG_SERVER_HTTPS = "true"
$env:DEBUG_SERVER_HTTPS_KEY = "C:\certificates\127.0.0.1-key.pem"
$env:DEBUG_SERVER_HTTPS_CERT = "C:\certificates\127.0.0.1.pem"
& ".\HTTP debug server\start-server.cmd"
```

私钥、证书和 `.env` 文件默认不会被 Git 跟踪。不要将真实业务私钥提交到公开仓库。

### 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DEBUG_NODE_EXE` | 自动查找 | 启动脚本使用的 Node 路径 |
| `DEBUG_SERVER_HOST` | `127.0.0.1` | 监听地址 |
| `DEBUG_SERVER_PORT` | HTTP `5050` / HTTPS `8443` | 监听端口 |
| `DEBUG_SERVER_ROOT` | `HTTP debug server/public` | 静态目录 |
| `DEBUG_SERVER_CORS` | 开启 | 设为 `false` 关闭 CORS |
| `DEBUG_LOG_BODY_LIMIT` | `2048` | 请求体日志预览最大字符数 |
| `DEBUG_PROXY_TARGET` | 空 | 上游服务地址 |
| `DEBUG_PROXY_PREFIX` | `/api/` | 需要代理的路径前缀 |
| `DEBUG_SERVER_HTTPS` | `false` | 是否启用 HTTPS |
| `DEBUG_SERVER_HTTPS_KEY` | `cert/server-key.pem` | PEM 私钥路径 |
| `DEBUG_SERVER_HTTPS_CERT` | `cert/server-cert.pem` | PEM 证书路径 |
| `DEBUG_SERVER_HTTPS_PASSPHRASE` | 空 | 加密私钥密码 |

## 局域网聊天室

聊天室启动脚本会先使用 pnpm 构建 `frontend/dist`，再由 Node.js 在同一端口提供页面、HTTP API 和 WebSocket。

### 当前功能

- 公共客厅和一对一单聊；
- 按 `user_id` 或昵称搜索用户，同一对用户只创建一个单聊；
- 文字和图片消息，消息类型结构可继续扩展；
- 选择、拖拽或粘贴图片发送；
- 图片大图查看、滚轮缩放和蒙层关闭；
- 图片按 SHA-256 去重保存到本地并建立 SQLite 索引；
- SQLite 历史记录、会话预览、未读数和全局搜索；
- 消息右键复制与撤回；
- 按日期插入时间提醒，使用动态高度虚拟消息列表；
- 浏览器新消息通知；
- token 鉴权、单聊成员权限检查和 WebSocket 定向推送；
- 启动时展示本机/局域网地址、静态目录和数据目录，运行时记录 HTTP、WebSocket、撤回与关闭日志；
- 断线自动重连及桌面、移动端布局。

### 消息与存储模型

消息按 `conversation_id` 保存，而不是按用户分别建立消息表：

```text
conversations
    │
    ├─ conversation_members  → 哪些用户有权访问会话
    │
    └─ messages              → 文字、图片和撤回提醒
           │
           └─ message_images → images → data/images/<hash>.<ext>
```

- 公共客厅固定使用会话 ID `1`；
- 单聊使用唯一的双方用户组合创建会话；
- 服务端根据 token 确定真实发送者，不信任客户端传入的用户身份；
- 只有会话成员可以读取、搜索、发送或接收该会话消息；
- 图片原始字节保存在 `data/images`，SQLite 保存哈希、元数据和消息关联；
- 撤回不会删除消息 ID，而是把原消息更新为可扩展的 `notice` 类型。

客户端发送格式：

```json
{
  "action": "message.send",
  "data": {
    "conversationId": 1,
    "type": "text",
    "payload": { "text": "你好" }
  }
}
```

标准消息结构：

```json
{
  "id": 1785890000000,
  "conversationId": 1,
  "type": "text",
  "senderId": "usr_...",
  "name": "访客",
  "avatar": "/柴郡.png",
  "createdAt": "2026-08-05T03:13:20.000Z",
  "payload": { "text": "你好" }
}
```

### 身份说明

页面首次打开时会创建 `user_id` 和一年有效期的 token，并保存到浏览器 LocalStorage。SQLite 只保存 token 的 SHA-256 哈希。个人资料页面可以复制 `user_id`，不会展示 token。

当前鉴权用于识别用户和隔离单聊数据，但还不是完整账号系统：没有密码、外部登录、好友申请、拉黑或多设备登录管理。清除浏览器 LocalStorage 可能导致当前设备失去原账号凭据。

### 配置

聊天室配置集中在 `Chat room server/config.js`：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `host` | `0.0.0.0` | 监听地址 |
| `port` | `8091` | HTTP 与 WebSocket 共用端口 |
| `defaultAvatar` | `/柴郡.png` | 默认图片头像 |
| `publicDir` | `frontend/dist` | Vue 构建产物目录 |
| `databaseFile` | `data/chat.db` | SQLite 数据库位置 |
| `imageDir` | `data/images` | 聊天图片目录 |
| `historyLimit` | `100` | 单次加载的最近消息数量 |
| `maxNameLength` | `24` | 昵称最大字符数 |
| `maxTextLength` | `20000` | 文字消息最大字符数 |
| `maxAvatarBytes` | `256 KiB` | 上传头像最大体积 |
| `maxImageBytes` | `2 MiB` | 单张聊天图片最大体积 |

默认头像源文件为 `Chat room server/frontend/src/assets/柴郡.png`。替换图片后重新启动聊天室即可重新构建。

## 局域网文件共享服务器

### 功能

- 选择文件、选择文件夹或拖拽上传；
- 文件夹上传时保留相对目录结构；
- 普通文件名附加时间戳和随机串，避免同名覆盖；
- 递归浏览、下载和删除文件；
- 默认单文件上限为 200 MiB；
- 自动创建 `uploads` 和 `log` 目录。

### API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/`、`/index.html` | 文件管理页面 |
| `GET` | `/api/files` | 递归列出共享文件 |
| `POST` | `/api/upload` | 上传原始二进制文件 |
| `GET` | `/api/download?name=...` | 下载文件 |
| `DELETE` | `/api/file?name=...` | 删除文件 |

### 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 监听地址 |
| `PORT` | `8090` | 监听端口 |
| `MAX_UPLOAD_SIZE` | `209715200` | 单文件上限，单位为字节 |
| `DEBUG_NODE_EXE` | 自动查找 | 启动脚本使用的 Node 路径 |

文件共享服务没有账号、访问控制或 TLS。任何能访问端口的设备都可以上传、下载和删除文件，请仅在可信局域网中临时使用。

根目录的 `局域网共享文件简易.cmd` 是依赖全局 `http-server` 的极简备选方案，只提供静态目录访问。通常应优先使用完整的文件共享服务。

## Git 与本地数据

仓库根目录的 `.gitignore` 已排除：

- `node_modules`、便携 Node.js 和前端 `dist`；
- SQLite、WAL 和 SHM 文件；
- 聊天图片、共享上传文件和运行日志；
- 本地 `Document` 开发文档目录；
- `.env`、私钥、自签证书和编辑器缓存。

这些目录会在安装、构建或首次启动时重新生成。执行提交前可以检查实际文件清单：

```powershell
git status --short --untracked-files=all
```

## 开发检查

```powershell
# 服务端语法检查
npm --prefix ".\Chat room server" run check
node --check ".\HTTP debug server\server.js"
node --check ".\File sharing server\server.js"

# 聊天室前端生产构建
pnpm --dir ".\Chat room server\frontend" build
```

## 安全提示

- 不要把真实业务 token、密码、Cookie 或私钥写入调试日志；
- HTTP 调试服务器会在控制台输出部分请求头和请求体；
- 聊天室 token 保存在 LocalStorage，应防止引入不可信脚本和 XSS；
- 文件共享服务没有鉴权，不能直接映射到公网；
- 如果需要长期或公网运行，应补充 TLS、正式登录、权限控制、速率限制、审计和备份策略。

## 常见问题

### 启动脚本提示找不到 Node

下载便携版 (Node.js)[https://nodejs.org/zh-cn/download/archive/v22.22.0] 解压到项目根目录

### 聊天室提示缺少依赖

重新执行“快速开始”中的 npm 和 pnpm 安装命令。

### 局域网设备无法访问

确认服务监听地址为 `0.0.0.0`，使用服务器电脑的 IPv4 访问，并检查 Windows 防火墙中的 8090/8091 端口规则。

### HTTPS 证书不受信任

确认签发证书的根 CA 已安装到系统信任区，并且证书中的域名或 IP 与实际访问地址一致。
