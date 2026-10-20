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
  const out = { root: "提交包", port: Number(process.env.PORT || 8790), quiet: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root" && argv[i + 1]) out.root = argv[++i];
    else if (a === "--port" && argv[i + 1]) out.port = Number(argv[++i]);
    else if (a === "--quiet") out.quiet = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}
const OPT = parseArgs(process.argv);
if (OPT.help) {
  console.log("用法: node live/server.js [--root 提交包] [--port 8790] [--quiet]");
  process.exit(0);
}

const ROOT = path.resolve(process.cwd(), OPT.root);
const LIVE_DIR = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const LEDGER = path.join(LIVE_DIR, "ledger.jsonl");
const START = Date.now();
let PORT = OPT.port;

/* ---------------- 小工具 ---------------- */
function log(...a) { if (!OPT.quiet) console.log("[live]", ...a); }
function stamp(d) { return new Date(d).toISOString(); }
function json(res, code, obj, extra) {
  const body = Buffer.from(JSON.stringify(obj, null, 2), "utf8");
  res.writeHead(code, Object.assign({
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  }, extra || {}));
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
function loadLedger() {
  try {
    const lines = fs.readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).slice(-50);
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

/* 引号感知的 CSV 行计数 + 指定列求和 / 去重（真解析，不糊弄） */
function csvMeasure(buf, sumCol, uniqCol) {
  let rows = 0, sum = 0, uniq = null, inQuote = false, lineStart = true, cell = "", col = 0, firstLine = true;
  if (uniqCol != null) uniq = new Set();
  for (let i = 0; i < buf.length; i++) {
    const ch = buf[i];
    if (ch === 0x22) { // "
      if (inQuote && buf[i + 1] === 0x22) { i++; continue; }
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && (ch === 0x0a || ch === 0x0d)) {
      if (ch === 0x0d && buf[i + 1] === 0x0a) i++;
      if (lineStart && rows === 0 && firstLine === false) { /* 空行 */ }
      if (!lineStart) {
        // 行结束：处理最后一格
        if (!firstLine) {
          rows++;
          if (sumCol != null && col === sumCol) sum += parseFloat(cell) || 0;
          if (uniqCol != null && col === uniqCol && cell) uniq.add(cell);
        } else {
          firstLine = false;
        }
      }
      cell = ""; col = 0; lineStart = true; inQuote = false;
      continue;
    }
    if (!inQuote && ch === 0x2c) { // ,
      if (!firstLine) {
        if (sumCol != null && col === sumCol) sum += parseFloat(cell) || 0;
        if (uniqCol != null && col === uniqCol && cell) uniq.add(cell);
        col++;
      }
      cell = ""; lineStart = false;
      continue;
    }
    cell += String.fromCharCode(ch);
    lineStart = false;
  }
  if (!firstLine && !lineStart) { // 最后一行没有换行
    rows++;
    if (sumCol != null && col === sumCol) sum += parseFloat(cell) || 0;
    if (uniqCol != null && col === uniqCol && cell) uniq.add(cell);
  }
  return { rows: rows, sum: sum, uniq: uniq ? uniq.size : undefined };
}

function readDataSnapshot() {
  const out = { at: Date.now(), files: [], totals: {} };
  for (const want of filesWanted) {
    const p = path.join(DATA_DIR, want.name);
    try {
      const st = fs.statSync(p);
      const buf = fs.readFileSync(p);
      const m = want.key === "positions"
        ? csvMeasure(buf, 8, 2)        // 岗位表：人数=第 9 列，单位=第 3 列
        : csvMeasure(buf, 2, null);    // 会话台账：提交次数=第 3 列
      out.files.push({
        key: want.key, name: want.name, bytes: st.size,
        mtime: st.mtimeMs, rows: m.rows, sum: m.sum, uniq: m.uniq
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
    broadcast({ type: "data", at: next.at, totals: next.totals, files: next.files });
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
        if (err) return;
        const k = "mtime:" + want.key;
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
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin": "*"
  });
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
  log("SSE 接入", c.tab || "-", "→", clients.size, "在线");
  req.on("close", () => { dropClient(c); log("SSE 断开 →", clients.size, "在线"); });
  req.on("error", () => dropClient(c));
}

/* ---------------- 事件入口 ---------------- */
function serveEvent(req, res) {
  if (req.method === "OPTIONS") { res.writeHead(204, corsHeaders()); return res.end(); }
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "只接受 POST" });
  let body = "";
  let over = false;
  req.on("data", (chunk) => {
    if (over) return;
    body += chunk;
    if (body.length > 64 * 1024) { over = true; json(res, 413, { ok: false, error: "事件体超过 64KB" }); req.destroy(); }
  });
  req.on("end", () => {
    if (over) return;
    let msg;
    try { msg = JSON.parse(body || "{}"); } catch (e) { return json(res, 400, { ok: false, error: "不是合法 JSON" }); }
    const name = msg.name || msg.type;
    if (!name || typeof name !== "string") return json(res, 400, { ok: false, error: "缺少 name" });
    const ev = pushEvent(name, msg.payload, { at: msg.at });
    log("事件", name, JSON.stringify(msg.payload || {}).slice(0, 120));
    json(res, 200, { ok: true, id: ev.id, clients: clients.size });
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
    data: dataSummary(),
    root: ROOT
  });
}
function serveHealth(req, res) {
  const d = dataSummary();
  const checks = [];
  const now = Date.now();
  checks.push({ name: "静态根目录可读", ok: fs.existsSync(ROOT), detail: ROOT });
  checks.push({ name: "岗位表 CSV 存在", ok: d.files.some((f) => f.key === "positions" && !f.missing), detail: (d.files.find((f) => f.key === "positions") || {}).name || "" });
  checks.push({ name: "会话台账 CSV 存在", ok: d.files.some((f) => f.key === "sessions" && !f.missing), detail: (d.files.find((f) => f.key === "sessions") || {}).name || "" });
  checks.push({ name: "岗位表已解析出行", ok: d.positions > 0, detail: d.positions + " 行" });
  checks.push({ name: "数据新鲜度 < 7 天", ok: d.scannedAt > 0 && (now - newestMtime(d)) < 7 * 86400000, detail: newestMtime(d) ? new Date(newestMtime(d)).toISOString() : "—" });
  checks.push({ name: "SSE 在线页签", ok: true, detail: clients.size + " 个" });
  checks.push({ name: "事件台账可写", ok: fs.existsSync(LIVE_DIR) && safeWritable(LIVE_DIR), detail: LEDGER });
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
  ".pdf": "application/pdf", ".zip": "application/zip", ".map": "application/json"
};
function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { return text(res, 400, "坏的 URL 编码"); }
  if (rel.includes("\0")) return text(res, 400, "非法路径");
  let p = path.normalize(path.join(ROOT, rel));
  if (p !== ROOT && !p.startsWith(ROOT + path.sep)) return text(res, 403, "越界访问被拒");
  fs.stat(p, (err, st) => {
    if (!err && st.isDirectory()) {
      if (!pathname.endsWith("/")) {
        res.writeHead(301, { Location: pathname + "/" }); return res.end();
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
        const head = Object.assign({
          "Content-Type": MIME[ext] || "application/octet-stream",
          "Content-Length": st2.size,
          "Last-Modified": st2.mtime.toUTCString(),
          "Cache-Control": /\.(html|htm|json|csv|txt|md|js|css)$/.test(ext) ? "no-cache" : "public, max-age=300",
          "Access-Control-Allow-Origin": "*"
        }, corsHeaders());
        if (/\.(html|htm)$/.test(ext)) Object.assign(head, { "Cache-Control": "no-store" });
        res.writeHead(200, head);
        if (req.method === "HEAD") return res.end();
        fs.createReadStream(file).on("error", () => res.end()).pipe(res);
      });
    }
  });
  function notFound() { text(res, 404, "404 · 没有这个文件：\n" + pathname + "\n\n提示：/ → 报告首页 · /app/ → 工作台 · /app/双端/ → 双端演示 · /live/ → 实时数据大屏"); }
}
function text(res, code, msg) {
  const b = Buffer.from(msg, "utf8");
  res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8", "Content-Length": b.length, "Access-Control-Allow-Origin": "*" });
  res.end(b);
}

/* ---------------- 路由 ---------------- */
const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);
  const p = parsed.pathname || "/";
  if (req.method === "OPTIONS" && p.startsWith("/live/")) { res.writeHead(204, corsHeaders()); return res.end(); }

  if (p === "/live/stream") return serveStream(req, res);
  if (p === "/live/event") return serveEvent(req, res);
  if (p === "/live/state") return serveState(req, res);
  if (p === "/live/health") return serveHealth(req, res);
  if (p === "/live" || p === "/live/") return serveDashboard(req, res);
  if (p === "/live/dashboard.js") return serveFileRaw(req, res, path.join(LIVE_DIR, "dashboard.js"), "application/javascript; charset=utf-8");
  if (p === "/live/live.css") return serveFileRaw(req, res, path.join(LIVE_DIR, "live.css"), "text/css; charset=utf-8");
  if (p === "/live/live.js") return serveFileRaw(req, res, path.join(LIVE_DIR, "live.js"), "application/javascript; charset=utf-8");

  serveStatic(req, res, p);
});

function serveFileRaw(req, res, file, type) {
  fs.readFile(file, (err, buf) => {
    if (err) return text(res, 404, "缺文件: " + file);
    res.writeHead(200, { "Content-Type": type, "Content-Length": buf.length, "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
    res.end(req.method === "HEAD" ? undefined : buf);
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
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && tries > 0) {
      log("端口", port, "被占用，换", port + 1);
      return boot(port + 1, tries - 1);
    }
    console.error("[live] 启动失败:", err.message);
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", () => {
    PORT = port;
    const base = "http://127.0.0.1:" + port;
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
  });
}
boot(PORT, 5);

/* 优雅退出：关 SSE、冲刷台账 */
process.on("SIGINT", () => {
  console.log("\n[live] 收工，正在断开", clients.size, "个连接…");
  for (const c of clients) { try { c.res.write("event: bye\ndata: {}\n\n"); c.res.end(); } catch (e) { } }
  flushLedger();
  setTimeout(() => process.exit(0), 200);
});
process.on("SIGTERM", () => process.exit(0));
