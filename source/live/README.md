# 星他 STARTA · 实时数据层（可选本地服务）

站点本身是静态的（GitHub Pages），没有后端；但「实时」这件事我们没造假。分成两层：

## 第一层：页面里本来就真（静态部署也成立）

- **真时钟**：顶栏 `实时 · HH:MM:SS` 每秒走的是浏览器系统时间。
- **真倒计时**：大兴安岭公告 `2026-10-26 17:00` 截止，页面按真实时间逐秒算剩余；过期就写「已截止」。
- **真相对时间**：「数据截至 17 小时前」取自真实数据文件的写入时间（mtime），不是本次打开页面的时间。
- **真跨页签同步**：`BroadcastChannel` + `localStorage`；两个页签同时开着，一边点对标/投递，另一边立刻变色并弹「另一标签页新增对标 · 现在 N 条」。
- **数字滚动只是呈现**：`Live.num()` 用 rAF 从 0 数到真实值，目标值来自 `data/` 里的真数据；连不上服务时不会偷偷往上拨。

三种状态口径写在状态胶囊里，不混：

| 胶囊 | 含义 |
| --- | --- |
| `实时` | 连上了本地 SSE 服务，在线页签数/心跳/数据变化都由服务端推送 |
| `同步` | 没连上服务，但同浏览器多页签之间真的在同步 |
| `快照` | 单文件双击离线打开，数字来自当次数据快照，不增长 |

## 第二层：连上这个零依赖服务就更真（本地演示用）

```bash
node source/live/server.js --port 8790            # 默认根目录指向 ../..，即提交包/
node source/live/server.js --root 提交包 --port 8790 --quiet
```

启动行为：

- `--port` 只接受 1–65535 的整数（含 `PORT` 环境变量）。`abc` / `0` / `99999` / 只写 `--port` → 打印一行中文错误并 `exit 2`，不会甩堆栈。
- 端口被占用时自动 `+1` 重试，最多换 5 次；横幅里打印的是**实际监听端口**。连续 5 次都被占 → 打印「端口 N 持续被占用，已放弃自动换端口」并 `exit 1`。
- 静态根不存在时会退回包根目录（有 `index.html` 的那层）；`Ctrl+C` 会断开 SSE、把台账缓冲刷盘再退出。

### 接口支持矩阵

| 方法与路径 | 行为 | 状态码 |
| --- | --- | --- |
| `GET /live/stream` | SSE：首包 `hello`（在线数/启动时间/数据指标/心跳号）+ 回放最近 12 条真实事件，之后每 4 秒心跳 | 200；非 GET → 405 `Allow: GET` |
| `POST /live/event` | 推一条真实事件：入环形缓冲（最近 50 条）并追加 `ledger.jsonl` | 200；非 POST → 405；非法 JSON → 400；`name` 缺失/非字符串 → 400；`name` > 200 字符 → 400；body > 64KB（UTF-8 字节）→ 413；跨源 `Origin` → 403；超速 → 429 |
| `OPTIONS /live/event` | CORS 预检 | 204 |
| `GET /live/state` | 当前状态 JSON（在线数/心跳/事件数/台账大小/数据指标/静态根） | 200 |
| `GET /live/health` | 7 项自检（目录、两份 CSV、行数、<7 天新鲜度、SSE、台账可写） | 全过 200，任一失败 500 |
| `GET /live/`、`GET /live` | 运营大屏 | 200 |
| `GET /live/live.js`、`/live/live.css`、`/live/dashboard.js` | 实时层自身资源（从服务目录读取，带 ETag） | 200 / 304 |
| 其它 `/live/*` | 不暴露（防止把 `ledger.jsonl`、`server.js` 当静态文件读走） | 404 |
| 静态站 `GET/HEAD /…` | `/`（报告）、`/app/`（工作台）、`/app/双端/`、`/report/` 等真实文件 | 200；目录补 `/` 301（保留 query）；隐藏文件/路径穿越 403；不存在 404；非 GET/HEAD 405 |

`POST /live/event` 的请求体：

```json
{ "name": "采集完成", "payload": { "rows": 9200 }, "at": 1792500000000 }
```

- `name` 必填；`payload` 任意可 JSON 化值（大屏截断展示 90 字符）；`at` 可省略。
- `at` 可以是毫秒时间戳或可被 `Date.parse` 解析的时间串；解析失败、≤0、或超过「现在 + 24 小时」的值一律落成服务端当前时间（不会让大屏出现 `Invalid Date`）。
- 只信同源写入：浏览器带 `Origin` 且 host 与请求 Host 不一致 → 403；命令行/脚本不带 `Origin` 可正常写。速率上限突发 60 条、之后 30 条/秒，超了返回 429 并带 `Retry-After: 1`。

### 静态细节

- `ETag`（弱）+ `Last-Modified` 协商缓存：`If-None-Match` 命中 → `304`。
- `Range`：支持单段 `bytes=a-b` / `a-` / `-n` → `206` + `Content-Range`；不可满足 → `416` + `Content-Range: bytes */总长`；多段/非法格式按完整 `200` 处理。大文件流式发送，HEAD 不发 body。
- `Cache-Control`：`html/htm/json/csv/txt/md/js/css` 为 `no-cache`（可缓存但每次校验，数据变了立刻可见）；图片、字体、PDF 等为 `public, max-age=300`。
- 安全响应头：`X-Content-Type-Options: nosniff`、`Referrer-Policy: same-origin`；静态资源另带 `Access-Control-Allow-Origin: *`。
- MIME 覆盖 html/css/js/json/csv/txt/md/svg/png/jpg/webp/gif/ico/woff2/ttf/pdf/zip/map，以及 `xlsx`/`docx` 的 OpenXML 类型；未知后缀回退 `application/octet-stream`。

### 数据与台账细节

- 服务直接读两份 CSV，引号感知解析：支持 BOM、CRLF/CR/LF、字段内逗号/双引号/换行；首行当表头。
- 岗位表按表头取「人数」求和、「单位」去重、数据行数计岗位；会话台账取「提交次数」求和并跳过首列为「合计」的汇总行（所以是 29 次，不是 29+29=58）。数字允许千分位（`1,200` → 1200）。
- 健壮性上限：单行最多 500 个单元格、单格最多 8192 字符（超出截断），防止病态大行吃穿内存；`/live/state` 的每个文件条目带 `cols` / `badRows` / `headerOk`，可直接核对表头识别与列数是否一致。
- `fs.watch` 真监听文件变化（Windows 上配 3 秒 mtime 轮询兜底）；文件被删/恢复也能靠轮询发现，值真变了才广播 `data` 事件——大屏数字跟着变，不轮询假刷新。
- 在线页签数来自真实 SSE 连接数；关掉一个页签，所有页面的胶囊数字立刻减一。写入慢到 1MB 还没发完的连接会被主动断开，防止一条坏连接拖垮广播。
- 事件台账 `ledger.jsonl` 只追加；启动时只读文件尾部 2MB 取最近 50 条，不会随台账增长吃内存/拖慢启动；新连接回放最近 12 条，刷新页面后仍能看到之前真实发生过什么。
- 事件 ID 由服务端单调递增分配（客户端传的 `id` 会被忽略），重启后从台账尾部恢复计数。

### 浏览器口径

- 组件本体（`live.js`）ES5、零依赖：不使用 `padStart`、`isConnected` 等新 API（IE11 可加载）；没有 `EventSource` 时自动降级成「同步」；`BroadcastChannel` 不可用时退回 `localStorage` 事件。
- 运营大屏 `/live/` 使用 `fetch`，需要 Chrome/Edge/Firefox/Safari 等现代浏览器，IE11 不保证。
- 单文件双击（`file://`）没有同源服务可连，状态是「快照」，数字不增长。

## 文件

| 文件 | 作用 |
| --- | --- |
| `live.js` | 页面端组件（`window.Live`）：状态胶囊、数字滚动、时钟、倒计时、相对时间、跨页签、SSE 客户端；ES5、零依赖 |
| `live.css` | 状态胶囊与数字样式，继承页面 `currentColor`，不抢主题 |
| `server.js` | 零依赖 Node 服务：静态站 + SSE + 事件/状态/体检接口 + CSV 解析 + 文件监听 |
| `dashboard.html` / `dashboard.js` | 运营大屏 |
