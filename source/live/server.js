#!/usr/bin/env node
/* =====================================================================
   星他 STARTA · 真实时数据服务  live/server.js  v1.0
   ---------------------------------------------------------------------
   零依赖 Node（只用 http / fs / path）。它做四件真事，不模拟：

   1. 静态站：把「提交包」按部署路径原样吐出（/ 报告、/app/ 工作台、
      /app/双端/ 双端演示），验证线上形态和本地一致；
   2. 真推送：GET /live/stream 是标准 SSE，服务端每 4 秒一次真心跳、
      页签进出立即广播在线数，数据文件真变了才推 data 事件；
   3. 真台账：POST /live/event 收事件，落盘 live/ledger.jsonl，环形
      缓冲回放最近 50 条给新连接（历史真实留存，刷新不丢）；
   4. 真数据体检：盯着提交包/data 里的真实 CSV，按需重算行数 / 单位 /
      招聘人数 / 会话成功失败，给 /live/health 一份可核对的自检。

   跑：node live/server.js            # http://127.0.0.1:8790
       node live/server.js --root 提交包 --port 8790
   ===================================================================== */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

/* ---------------- 参数 ---------------- */
function parseArgs(argv) {
  const envPort = process.env.PORT == null || process.env.PORT === "" ? null : process.env.PORT;
  const out = { root: "提交包", portRaw: envPort == null ? "8790" : envPort, quiet: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root" && argv[i + 1]) out.root = argv[++i];
    else if (a === "--port") {
      if (i + 1 >= argv.length) { out.portRaw = null; out.portError = "缺少端口值"; break; }
      out.portRaw = argv[++i];
    }
    else if (a === "--quiet") out.quiet = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}
function parsePort(raw) {
  if (raw == null || String(raw).trim() === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}
const OPT = parseArgs(process.argv);
if (OPT.help) {
  console.log("用法: node server.js [--root 提交包] [--port 8790] [--quiet]");
  process.exit(0);
}
const PORT_NUM = parsePort(OPT.portRaw);
if (PORT_NUM == null) {
  console.error("[live] 端口无效：" + (OPT.portRaw == null ? "(空)" : JSON.stringify(OPT.portRaw)) +
    "（" + (OPT.portError || "应为 1–65535 的整数") + "）");
  process.exit(2);
}

let ROOT = path.resolve(process.cwd(), OPT.root);
// 兼容「把提交包当部署根目录」的跑法：在 提交包/ 下执行 `node source/live/server.js` 时，
// 默认的 提交包/提交包 不存在，自动退回 server.js 所在仓库的根目录（source/live/../..）。
if (!fs.existsSync(ROOT)) {
  const pkgRoot = path.resolve(__dirname, "..", "..");
  if (fs.existsSync(path.join(pkgRoot, "index.html"))) ROOT = pkgRoot;
}
const LIVE_DIR = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const LEDGER = path.join(LIVE_DIR, "ledger.jsonl");
const START = Date.now();
let PORT = PORT_NUM;

/* ---------------- 小工具 ---------------- */
/* 写日志也要防呆：后台作业的 stdout 管道可能在外部被关掉，
   console.log 抛 EPIPE 会直接带走整个服务（实测 exit code 1、无堆栈）。 */
function log(...a) {
  if (OPT.quiet) return;
  try {
    if (process.stdout && process.stdout.writable) console.log("[live]", ...a);
  } catch (e) { /* 日志丢了可以，服务不能死 */ }
}
/* SSE 接入/断开是高频噪音：同一秒几十次重连会把日志管道打爆，
   只记录开头的少数几条和每 25 条一次。 */
let sseNoise = 0;
function logSse(...a) {
  if (sseNoise++ % 25 === 0 || clients.size <= 3) log(...a);
}
function stamp(d) { return new Date(d).toISOString(); }
/* 安全响应头：
   - nosniff 阻止 MIME 嗅探；
   - Referrer-Policy 避免把内网地址带去外链；
   - X-Frame-Options / CSP frame-ancestors 双重防嵌套（SAMEORIGIN）；
   - CSP 允许 'unsafe-inline'：单文件报告/工作台和大屏都是内联 script/style；
     connect-src 'self' 覆盖 SSE/fetch；img-src 允许 data: 图标；
   - Permissions-Policy 关掉演示不需要的硬件权限。 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'"
].join("; ");
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy": CSP,
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
};
function json(res, code, obj, extra) {
  const body = Buffer.from(JSON.stringify(obj, null, 2), "utf8");
  res.writeHead(code, Object.assign({
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  }, SECURITY_HEADERS, extra || {}));
  res.end(body);
}

/* ---------------- 客户端池 ---------------- */
const clients = new Set();
const history = [];            // 环形缓冲：最近 50 条事件
let eventSeq = 0;
let beat = 0;

function broadcast(obj, only) {
  const line = "data: " + JSON.stringify(obj) + "\n\n";
  for (const c of clients) {
    if (only && !only(c)) continue;
    /* 慢客户端背压保护：网络差/标签页假死的连接写不出去时，res.write 只会一直
       往内核/进程缓冲里堆。超过 1MB 未写出的直接断开，别让一条连接拖垮整个服务。 */
    if (c.res.writableLength > 1024 * 1024) { dropClient(c); continue; }
    try { c.res.write(line); } catch (e) { dropClient(c); }
  }
}
function dropClient(c) {
  clients.delete(c);
  try { c.res.end(); } catch (e) { }
  broadcast({ type: "clients", n: clients.size, at: Date.now() });
}
function pushEvent(name, payload, meta) {
  const ev = {
    type: "event",
    id: ++eventSeq,
    name: String(name || "event"),
    payload: payload == null ? null : payload,
    at: (meta && meta.at) || Date.now(),
    replay: !!(meta && meta.replay)
  };
  if (!ev.replay) {
    history.push(ev);
    if (history.length > 50) history.shift();
    appendLedger(ev);
  }
  broadcast(ev);
  return ev;
}

/* 台账：真落盘（追加 JSONL）；失败不影响推送 */
let ledgerQueue = [];
let ledgerTimer = null;
function appendLedger(ev) {
  ledgerQueue.push(JSON.stringify(ev));
  if (ledgerTimer) return;
  ledgerTimer = setTimeout(flushLedger, 120);
}
function flushLedger() {
  ledgerTimer = null;
  if (!ledgerQueue.length) return;
  const chunk = ledgerQueue.join("\n") + "\n";
  ledgerQueue = [];
  fs.appendFile(LEDGER, chunk, (err) => { if (err) log("台账写入失败:", err.message); });
}
/* 台账只追加，回放只要最后 50 条：只读文件尾部 2MB，不把几十 MB 台账整个读进内存 */
const LEDGER_TAIL_BYTES = 2 * 1024 * 1024;
/* 单条台账行上限 1MB：正常 payload ≤64KB，超长/损坏行直接跳过，不让一行毒掉整段回放 */
const MAX_LEDGER_LINE = 1024 * 1024;
function readTail(file, maxBytes) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    if (size <= 0) return "";
    let window = Math.min(size, maxBytes);
    const hardLimit = maxBytes * 4; // 最多扩窗到 8MB，防被超长行拖进无底洞
    for (;;) {
      const start = size - window;
      const buf = Buffer.alloc(window);
      fs.readSync(fd, buf, 0, window, start);
      let s = buf.toString("utf8");
      /* 从中间截断时，第一行可能是半行，丢掉 */
      if (start > 0) { const i = s.indexOf("\n"); s = i >= 0 ? s.slice(i + 1) : ""; }
      if (s || start === 0) return s;
      /* 尾部被一条超长行整段占满（找不到换行）：扩窗再读，跳过该行保留前面的完整行 */
      if (window >= hardLimit || window >= size) { log("台账尾部单行超长，已跳过该行"); return ""; }
      window = Math.min(size, window * 2);
    }
  } finally { fs.closeSync(fd); }
}
function loadLedger() {
  try {
    const lines = readTail(LEDGER, LEDGER_TAIL_BYTES).split("\n").filter(Boolean)
      .filter((l) => l.length <= MAX_LEDGER_LINE)
      .slice(-50);
    for (const l of lines) {
      try { const e = JSON.parse(l); if (e && e.type === "event") history.push(e); } catch (e2) { }
    }
    if (history.length) eventSeq = Math.max(eventSeq, ...history.map((e) => e.id || 0));
    log("台账回放", history.length, "条历史事件");
  } catch (e) { /* 首次运行没有台账，正常 */ }
}

/* ---------------- 真实数据体检 ---------------- */
const filesWanted = [
  { name: "岗位表_统一字段.csv", key: "positions" },
  { name: "会话台账.csv", key: "sessions" }
];
let dataSnapshot = null;

/* 引号感知的 CSV 行计数 + 指定列求和 / 去重（真解析，不糊弄）
   skipTotal=true 时会跳过首列为「合计」的汇总行，避免把合计行再算一遍
   （会话台账 CSV 既有 4 个批次行，又有 1 行合计，直接求和会把 29 算成 58）。
   另做基本校验：首行当表头 → 记录列数/表头关键字，数据行列数不一致计入 badRows；
   数字允许千分位（1,200）；单行/单格设上限，防止病态 CSV 把内存吃穿。 */
const MAX_ROW_CELLS = 500;
const MAX_CELL_CHARS = 8192;
/* 真实岗位表约 4MB；超过 32MB 的 CSV 直接拒绝解析并在状态里标 oversized，
   避免 readFileSync 把病态大文件整个吃进内存（health 会因解析出 0 行而变红）。 */
const MAX_CSV_BYTES = 32 * 1024 * 1024;
function csvNumber(s) {
  const v = String(s == null ? "" : s).replace(/[,，\s]/g, "");
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function csvMeasure(input, sumCol, uniqCol, skipTotal, opts) {
  opts = opts || {};
  const headerNames = opts.header || null;
  const buf = typeof input === "string" ? input : input.toString("utf8");
  let rows = 0, sum = 0, uniq = uniqCol != null ? new Set() : null;
  let inQuote = false, lineStart = true, cell = "", col = 0, firstLine = true;
  let firstCell = "", headerCols = 0, badRows = 0, header = [];
  const totalRow = () => !!skipTotal && /^\s*合计/.test(firstCell);
  const add = (text, last) => {
    if (firstLine) {
      header.push(text);
      if (last) { headerCols = header.length; firstLine = false; }
      return;
    }
    if (totalRow()) return;
    if (sumCol != null && col === sumCol) sum += csvNumber(text);
    if (uniqCol != null && col === uniqCol && text) uniq.add(text);
    if (last) {
      if (headerCols && col + 1 !== headerCols) badRows++;
      rows++;
    }
  };
  for (let i = 0; i < buf.length; i++) {
    const ch = buf.charCodeAt(i);
    if (ch === 0x22) { // "
      if (inQuote && buf.charCodeAt(i + 1) === 0x22) { i++; continue; }
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && (ch === 0x0a || ch === 0x0d)) {
      if (ch === 0x0d && buf.charCodeAt(i + 1) === 0x0a) i++;
      if (!lineStart) {
        if (col === 0) firstCell = cell;
        add(cell, true);
      }
      cell = ""; col = 0; firstCell = ""; lineStart = true; inQuote = false;
      continue;
    }
    if (!inQuote && ch === 0x2c) { // ,
      if (col === 0 && !firstLine) firstCell = cell;
      if (col < MAX_ROW_CELLS) add(cell, false);
      col++;
      cell = ""; lineStart = false;
      continue;
    }
    if (cell.length < MAX_CELL_CHARS) cell += String.fromCharCode(ch);
    lineStart = false;
  }
  if (!firstLine && !lineStart) { // 最后一行没有换行
    if (col === 0) firstCell = cell;
    add(cell, true);
  }
  let headerOk = true;
  if (headerNames) {
    const cells = header.map((x) => String(x || "").replace(/^\uFEFF/, "").trim());
    headerOk = headerCols > 0 && headerNames.every((h) => cells.some((c) => c === h || c.indexOf(h) >= 0));
  }
  return { rows: rows, sum: sum, uniq: uniq ? uniq.size : undefined, cols: headerCols, badRows: badRows, headerOk: headerOk };
}

function readDataSnapshot() {
  const out = { at: Date.now(), files: [], totals: {} };
  for (const want of filesWanted) {
    const p = path.join(DATA_DIR, want.name);
    try {
      const st = fs.statSync(p);
      /* 先看大小再读：32MB 上限，超大文件不解析、标 oversized，让 health 明确变红 */
      if (st.size > MAX_CSV_BYTES) {
        out.files.push({
          key: want.key, name: want.name, bytes: st.size, mtime: st.mtimeMs,
          oversized: true, rows: 0, sum: 0, uniq: want.key === "positions" ? 0 : undefined,
          cols: 0, badRows: 0, headerOk: false
        });
        continue;
      }
      const buf = fs.readFileSync(p);
      const m = want.key === "positions"
        ? csvMeasure(buf, 8, 2, false, { header: ["人数", "单位"] }) // 岗位表：人数=第 9 列，单位=第 3 列
        : csvMeasure(buf, 2, null, true, { header: ["提交次数"] });    // 会话台账：提交次数=第 3 列，跳过「合计」行
      out.files.push({
        key: want.key, name: want.name, bytes: st.size,
        mtime: st.mtimeMs, rows: m.rows, sum: m.sum, uniq: m.uniq,
        cols: m.cols, badRows: m.badRows, headerOk: m.headerOk
      });
      Object.assign(out.totals, want.key === "positions"
        ? { positions: m.rows, employers: m.uniq, hires: m.sum }
        : { submits: m.sum, sessions: m.rows });
    } catch (e) {
      out.files.push({ key: want.key, name: want.name, missing: true, error: e.code });
    }
  }
  return out;
}
function dataSummary() {
  const t = (dataSnapshot && dataSnapshot.totals) || {};
  return {
    positions: t.positions || 0,
    employers: t.employers || 0,
    hires: t.hires || 0,
    submits: t.submits || 0,
    sessions: t.sessions || 0,
    files: (dataSnapshot && dataSnapshot.files) || [],
    scannedAt: dataSnapshot ? dataSnapshot.at : 0
  };
}
function dataFreshness() {
  let t = 0;
  if (dataSnapshot) for (const f of dataSnapshot.files) if (f.mtime && f.mtime > t) t = f.mtime;
  return t || dataSummary().scannedAt;
}
function refreshData(why) {
  const next = readDataSnapshot();
  const before = dataSnapshot ? JSON.stringify(dataSnapshot.totals) + JSON.stringify(dataSnapshot.files.map((f) => [f.rows, f.mtime])) : "";
  const after = JSON.stringify(next.totals) + JSON.stringify(next.files.map((f) => [f.rows, f.mtime]));
  dataSnapshot = next;
  if (before !== after) {
    log("数据变化（" + why + "）→", after);
    broadcast({ type: "data", at: next.at, asOf: dataFreshness(), totals: next.totals, files: next.files });
  }
}

/* fs.watch 真监听；Windows 上偶有丢事件，配 3 秒轮询兜底（只比 mtime，很便宜） */
const watchState = {};
function watchData() {
  for (const want of filesWanted) {
    const p = path.join(DATA_DIR, want.name);
    try {
      const w = fs.watch(p, { persistent: false }, () => {
        clearTimeout(watchState[want.key]);
        watchState[want.key] = setTimeout(() => refreshData(want.name), 250);
      });
      w.on("error", () => { });
    } catch (e) { log("监听失败:", want.name, e.code); }
  }
  setInterval(() => {
    for (const want of filesWanted) {
      const p = path.join(DATA_DIR, want.name);
      fs.stat(p, (err, st) => {
        const mk = "missing:" + want.key;
        if (err) {
          /* fs.watch 在部分环境（网络盘/权限/文件被删）不可用，轮询兜底也要发现“文件没了”，
             不能一直沿用旧快照假装健康。missing 状态只刷新一次，避免每 3 秒重复广播。 */
          if (!watchState[mk]) { watchState[mk] = true; refreshData(want.name + " 缺失"); }
          return;
        }
        const k = "mtime:" + want.key;
        if (watchState[mk]) {
          watchState[mk] = false;
          watchState[k] = st.mtimeMs;
          refreshData(want.name + " 恢复");
          return;
        }
        if (watchState[k] !== st.mtimeMs) {
          watchState[k] = st.mtimeMs;
          refreshData(want.name + " mtime");
        }
      });
    }
  }, 3000);
}

/* ---------------- SSE ---------------- */
function serveStream(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, error: "SSE 只接受 GET" }, { Allow: "GET" });
  res.writeHead(200, Object.assign({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin": "*"
  }, SECURITY_HEADERS));
  res.on("error", () => { });
  res.write("retry: 3000\n\n");
  const c = { res: res, at: Date.now(), tab: "", ua: req.headers["user-agent"] || "" };
  clients.add(c);
  const q = url.parse(req.url, true).query;
  c.tab = q.tab || "";
  // 首包：告诉客户端确实连上了，并给全量状态
  c.res.write("data: " + JSON.stringify({
    type: "hello", clients: clients.size, since: START, asOf: dataFreshness(),
    beat: beat, version: "1.0.0", server: "starta-live", data: dataSummary()
  }) + "\n\n");
  // 回放真实历史事件（新页签能看到之前发生过什么）
  for (const ev of history.slice(-12)) {
    c.res.write("data: " + JSON.stringify(Object.assign({}, ev, { replay: true })) + "\n\n");
  }
  broadcast({ type: "clients", n: clients.size, at: Date.now() }, (x) => x !== c);
  logSse("SSE 接入", c.tab || "-", "→", clients.size, "在线");
  req.on("close", () => { dropClient(c); logSse("SSE 断开 →", clients.size, "在线"); });
  req.on("error", () => dropClient(c));
}

/* ---------------- 事件入口 ---------------- */
/* 简单令牌桶：突发 60 条、之后 30 条/秒；本地演示足够，也挡住脚本瞬间刷爆台账。
   按来源 IP 分桶（req.socket.remoteAddress，绝不信任 X-Forwarded-For），
   多客户端互不影响；Map 超过 2000 个来源时清理最旧的一半，防被扫爆内存。 */
const RATE_MAX = 60;
const RATE_REFILL = 30; // 条/秒
const RATE_MAX_IPS = 2000;
const rateBuckets = new Map();
function rateAllow(req) {
  const ip = (req && req.socket && req.socket.remoteAddress) || "unknown";
  const now = Date.now();
  let b = rateBuckets.get(ip);
  if (!b) { b = { tokens: RATE_MAX, at: now }; rateBuckets.set(ip, b); }
  b.tokens = Math.min(RATE_MAX, b.tokens + ((now - b.at) / 1000) * RATE_REFILL);
  b.at = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  if (rateBuckets.size > RATE_MAX_IPS) {
    const arr = Array.from(rateBuckets.entries()).sort((a, b2) => a[1].at - b2[1].at);
    for (let i = 0; i < arr.length / 2; i++) rateBuckets.delete(arr[i][0]);
  }
  return true;
}
function serveEvent(req, res) {
  if (req.method === "OPTIONS") { res.writeHead(204, Object.assign(corsHeaders(), SECURITY_HEADERS)); return res.end(); }
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "只接受 POST" }, { Allow: "POST, OPTIONS" });
  /* 只信同源写入：不然任意网页都能对 127.0.0.1:8790 发一个 simple POST 注入事件
     （配合大屏未转义渲染就是存储型 XSS）。 */
  const origin = req.headers.origin;
  if (origin) {
    let host = "";
    try { host = new URL(origin).host; } catch (e) { host = ""; }
    if (host !== (req.headers.host || "")) return json(res, 403, { ok: false, error: "跨域写入被拒绝" });
  }
  let body = "";
  let over = false;
  req.on("data", (chunk) => {
    if (over) return;
    body += chunk;
    /* 上限按真实字节算：body.length 是 UTF-16 字符数，中文 22,000 字 ≈ 66KB 会被漏放 */
    if (Buffer.byteLength(body, "utf8") > 64 * 1024) { over = true; json(res, 413, { ok: false, error: "事件体超过 64KB" }); req.destroy(); }
  });
  req.on("end", () => {
    if (over) return;
    let msg;
    try { msg = JSON.parse(body || "{}"); } catch (e) { return json(res, 400, { ok: false, error: "不是合法 JSON" }); }
    const name = msg.name || msg.type;
    if (!name || typeof name !== "string") return json(res, 400, { ok: false, error: "缺少 name" });
    if (name.length > 200) return json(res, 400, { ok: false, error: "name 太长（上限 200 字符）" });
    if (!rateAllow(req)) return json(res, 429, { ok: false, error: "事件太频繁，1 秒后再试" }, { "Retry-After": "1" });
    /* at 只认可解析的时间；非法/对象/太远的未来一律用服务端当前时间，避免大屏出现 Invalid Date。
       把“是否被修正”通过 atAdjusted 告诉调用方，客户端可自行决定是否提示/重试。 */
    let at = msg.at;
    let atAdjusted = false;
    if (at === undefined || at === null) {
      at = Date.now();
    } else {
      if (typeof at === "string") at = at.trim() ? Date.parse(at) : NaN;
      if (!Number.isFinite(at) || at <= 0 || at > Date.now() + 86400000) { at = Date.now(); atAdjusted = true; }
    }
    const ev = pushEvent(name, msg.payload, { at: at });
    log("事件", name, JSON.stringify(msg.payload || {}).slice(0, 120));
    json(res, 200, { ok: true, id: ev.id, at: ev.at, atAdjusted: atAdjusted, clients: clients.size });
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600"
  };
}

/* ---------------- 状态 / 体检 ---------------- */
function serveState(req, res) {
  json(res, 200, {
    ok: true,
    service: "starta-live",
    version: "1.0.0",
    uptimeMs: Date.now() - START,
    clients: clients.size,
    beats: beat,
    since: START,
    events: history.length,
    ledger: safeSize(LEDGER),
    data: dataSummary()
  });
}
function serveHealth(req, res) {
  const d = dataSummary();
  const checks = [];
  const now = Date.now();
  /* detail 只给相对位置，不把绝对路径（用户名/盘符/目录结构）漏给 HTTP 客户端 */
  checks.push({ name: "静态根目录可读", ok: fs.existsSync(ROOT), detail: "." });
  checks.push({ name: "岗位表 CSV 存在", ok: d.files.some((f) => f.key === "positions" && !f.missing), detail: (d.files.find((f) => f.key === "positions") || {}).name || "" });
  checks.push({ name: "会话台账 CSV 存在", ok: d.files.some((f) => f.key === "sessions" && !f.missing), detail: (d.files.find((f) => f.key === "sessions") || {}).name || "" });
  checks.push({ name: "岗位表已解析出行", ok: d.positions > 0, detail: d.positions + " 行" });
  checks.push({ name: "数据新鲜度 < 7 天", ok: d.scannedAt > 0 && (now - newestMtime(d)) < 7 * 86400000, detail: newestMtime(d) ? new Date(newestMtime(d)).toISOString() : "—" });
  checks.push({ name: "SSE 在线页签", ok: true, detail: clients.size + " 个" });
  checks.push({ name: "事件台账可写", ok: fs.existsSync(LIVE_DIR) && safeWritable(LIVE_DIR), detail: path.relative(path.dirname(LIVE_DIR), LEDGER).replace(/\\/g, "/") || "ledger.jsonl" });
  const failed = checks.filter((c) => !c.ok).length;
  json(res, failed ? 500 : 200, {
    ok: failed === 0,
    checkedAt: new Date().toISOString(),
    checks: checks,
    failed: failed,
    data: d,
    uptimeMs: now - START,
    clients: clients.size
  });
}
function newestMtime(d) {
  return Math.max(0, ...(d.files || []).map((f) => f.mtime || 0));
}
function safeSize(p) { try { return fs.statSync(p).size; } catch (e) { return 0; } }
function safeWritable(dir) { try { fs.accessSync(dir, fs.constants.W_OK); return true; } catch (e) { return false; } }

/* ---------------- 静态 ---------------- */
const MIME = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8", ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8", ".svg": "image/svg+xml",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf",
  ".pdf": "application/pdf", ".zip": "application/zip", ".map": "application/json",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
};
/* 弱 ETag：文件大小 + mtime 足够做协商缓存（内容变了这两者必变） */
function weakEtag(size, mtimeMs) {
  return 'W/"' + size.toString(16) + "-" + Math.floor(mtimeMs).toString(16) + '"';
}
function inmMatches(header, etag) {
  return String(header || "").split(",").some((t) => {
    t = t.trim();
    if (!t) return false;
    if (t === "*" || t === etag) return true;
    return t.replace(/^W\//, "") === etag.replace(/^W\//, "");
  });
}
/* 只支持单段 Range（bytes=a-b / a- / -n）；多段/非法格式按普通 200 处理 */
function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m) return null;
  if (m[1] === "" && m[2] === "") return "invalid";
  let start, end;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Number(m[2]);
    if (end >= size) end = size - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) return "invalid";
  return { start: start, end: end };
}
function serveStatic(req, res, pathname, search) {
  if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { ok: false, error: "静态资源只接受 GET/HEAD" }, { Allow: "GET, HEAD" });
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { return text(res, 400, "坏的 URL 编码"); }
  if (rel.includes("\0")) return text(res, 400, "非法路径");
  /* 隐藏文件/目录（.git/.env/.hidden…）一律不对外：静态站点根下常常带着 .git */
  if (rel.split(/[\\/]+/).some(function (seg) { return seg.charAt(0) === "."; })) return text(res, 403, "隐藏文件不对外提供");
  let p = path.normalize(path.join(ROOT, rel));
  if (p !== ROOT && !p.startsWith(ROOT + path.sep)) return text(res, 403, "越界访问被拒");
  fs.stat(p, (err, st) => {
    if (!err && st.isDirectory()) {
      if (!pathname.endsWith("/")) {
        /* 保留 query：否则 /app?x=1 跳转后参数丢失 */
        res.writeHead(301, Object.assign({ Location: pathname + "/" + (search || "") }, SECURITY_HEADERS));
        return res.end();
      }
      const idx = path.join(p, "index.html");
      return fs.existsSync(idx) ? sendFile(idx) : text(res, 403, "目录无 index.html");
    }
    if (err) return notFound();
    sendFile(p);
    function sendFile(file) {
      fs.stat(file, (e2, st2) => {
        if (e2 || !st2.isFile()) return notFound();
        const ext = path.extname(file).toLowerCase();
        const etag = weakEtag(st2.size, st2.mtimeMs);
        const head = Object.assign({
          "Content-Type": MIME[ext] || "application/octet-stream",
          "Last-Modified": st2.mtime.toUTCString(),
          "ETag": etag,
          "Accept-Ranges": "bytes",
          /* no-cache = 可以存，但每次用 ETag/Last-Modified 校验（数据频繁变，省流量又不吃旧文件） */
          "Cache-Control": /\.(html|htm|json|csv|txt|md|js|css)$/.test(ext) ? "no-cache" : "public, max-age=300",
          "Access-Control-Allow-Origin": "*"
        }, SECURITY_HEADERS, corsHeaders());
        if (req.headers["if-none-match"] && inmMatches(req.headers["if-none-match"], etag)) {
          res.writeHead(304, head); return res.end();
        }
        const range = parseRange(req.headers.range, st2.size);
        if (range === "invalid") {
          return text(res, 416, "Range 不可满足", { "Content-Range": "bytes */" + st2.size });
        }
        let start = 0, end = st2.size - 1, code = 200;
        if (range) { start = range.start; end = range.end; code = 206; head["Content-Range"] = "bytes " + start + "-" + end + "/" + st2.size; }
        head["Content-Length"] = st2.size === 0 ? 0 : end - start + 1;
        res.writeHead(code, head);
        if (req.method === "HEAD") return res.end();
        const stream = code === 206 ? fs.createReadStream(file, { start: start, end: end }) : fs.createReadStream(file);
        stream.on("error", () => res.end()).pipe(res);
      });
    }
  });
  function notFound() { text(res, 404, "404 · 没有这个文件：\n" + pathname + "\n\n提示：/ → 报告首页 · /app/ → 工作台 · /app/双端/ → 双端演示 · /live/ → 实时数据大屏"); }
}
function text(res, code, msg, extra) {
  const b = Buffer.from(msg, "utf8");
  res.writeHead(code, Object.assign({
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": b.length,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  }, SECURITY_HEADERS, extra || {}));
  res.end(b);
}

/* ---------------- 路由 ---------------- */
const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);
  const p = parsed.pathname || "/";
  if (req.method === "OPTIONS" && p.startsWith("/live/")) { res.writeHead(204, Object.assign(corsHeaders(), SECURITY_HEADERS)); return res.end(); }

  if (p === "/live/stream") return serveStream(req, res);
  if (p === "/live/event") return serveEvent(req, res);
  if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { ok: false, error: "只接受 GET/HEAD" }, { Allow: "GET, HEAD" });
  if (p === "/live/state") return serveState(req, res);
  if (p === "/live/health") return serveHealth(req, res);
  if (p === "/live" || p === "/live/") return serveDashboard(req, res);
  if (p === "/live/dashboard.js") return serveFileRaw(req, res, path.join(LIVE_DIR, "dashboard.js"), "application/javascript; charset=utf-8");
  if (p === "/live/live.css") return serveFileRaw(req, res, path.join(LIVE_DIR, "live.css"), "text/css; charset=utf-8");
  if (p === "/live/live.js") return serveFileRaw(req, res, path.join(LIVE_DIR, "live.js"), "application/javascript; charset=utf-8");
  /* /live/* 只暴露上面这几个入口；否则从仓库根起服务时 ledger.jsonl、server.js
     会被当成普通静态文件读走（事件 payload 可能含业务数据）。 */
  if (p.startsWith("/live/")) return text(res, 404, "404 · 没有这个实时层资源：" + p);

  serveStatic(req, res, p, parsed.search);
});

function serveFileRaw(req, res, file, type) {
  /* 404 只回文件名，不回绝对路径（避免把用户名/目录结构漏给客户端） */
  const label = path.basename(file);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return text(res, 404, "缺文件: " + label);
    const etag = weakEtag(st.size, st.mtimeMs);
    const head = Object.assign({
      "Content-Type": type,
      "Cache-Control": "no-cache",
      "ETag": etag,
      "Access-Control-Allow-Origin": "*"
    }, SECURITY_HEADERS, corsHeaders());
    if (req.headers["if-none-match"] && inmMatches(req.headers["if-none-match"], etag)) {
      res.writeHead(304, head); return res.end();
    }
    fs.readFile(file, (err2, buf) => {
      if (err2) return text(res, 404, "缺文件: " + label);
      head["Content-Length"] = buf.length;
      res.writeHead(200, head);
      res.end(req.method === "HEAD" ? undefined : buf);
    });
  });
}
function serveDashboard(req, res) {
  serveFileRaw(req, res, path.join(LIVE_DIR, "dashboard.html"), "text/html; charset=utf-8");
}

/* ---------------- 心跳（真 · 每 4 秒） ---------------- */
function startHeartbeat() {
  setInterval(() => {
    beat++;
    broadcast({
      type: "heartbeat", beat: beat, at: Date.now(),
      clients: clients.size,
      uptimeMs: Date.now() - START,
      data: dataSummary().positions || 0
    });
  }, 4000);
}

/* ---------------- 启动 ---------------- */
function boot(port, tries) {
  let current = port;
  let started = false;
  const onListening = () => {
    if (started) return;
    started = true;
    const actual = server.address().port;
    PORT = actual;
    const base = "http://127.0.0.1:" + actual;
    console.log("");
    console.log("  星他 STARTA · 实时数据服务 v1.0");
    console.log("  ------------------------------------------------");
    console.log("  报告首页     " + base + "/");
    console.log("  招聘工作台   " + base + "/app/");
    console.log("  双端演示     " + base + "/app/双端/");
    console.log("  实时大屏     " + base + "/live/");
    console.log("  体检报告     " + base + "/live/health");
    console.log("  SSE 流       " + base + "/live/stream");
    console.log("  静态根       " + ROOT);
    console.log("  ------------------------------------------------");
    console.log("  Ctrl+C 停止。页面会自动从“静态快照”切到“实时”。");
    console.log("");
    loadLedger();
    refreshData("启动");
    watchData();
    startHeartbeat();
  };
  /* 只挂一次监听/错误处理器：EADDRINUSE 重试时不再递归叠加 listener
     （旧写法连续换端口会触发 MaxListenersExceededWarning 并重复进 listening 回调）。 */
  server.on("listening", onListening);
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && tries > 0) {
      log("端口", current, "被占用，换", current + 1);
      current += 1;
      tries -= 1;
      return server.listen(current, "127.0.0.1");
    }
    /* 已经在跑的时候再出 error（比如个别连接上的 socket 异常）不该把整个服务带走 */
    if (server.listening) { log("运行时错误已兜住：", err.code || "", err.message); return; }
    console.error("[live] 启动失败:", err.message +
      (err.code === "EADDRINUSE" ? "（端口 " + current + " 持续被占用，已放弃自动换端口）" : ""));
    process.exit(1);
  });
  server.listen(current, "127.0.0.1");
}
boot(PORT, 5);

/* 兜底：本地演示服务不能被一次写失败/坏请求带走。
   真出异常就记一行、继续服务；外面还有 supervisor 兜第二层。 */
process.on("uncaughtException", (e) => {
  log("内部异常已兜住：", (e && e.message) || String(e));
});
process.on("unhandledRejection", (e) => {
  log("未处理的 Promise：", (e && e.message) || String(e));
});

/* 优雅退出：关 SSE、冲刷台账 */
process.on("SIGINT", () => {
  console.log("\n[live] 收工，正在断开", clients.size, "个连接…");
  for (const c of clients) { try { c.res.write("event: bye\ndata: {}\n\n"); c.res.end(); } catch (e) { } }
  flushLedger();
  setTimeout(() => process.exit(0), 200);
});
process.on("SIGTERM", () => process.exit(0));
