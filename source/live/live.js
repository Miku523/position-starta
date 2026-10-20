/* =====================================================================
   星他 STARTA · 实时数据层 Live v1.0
   ---------------------------------------------------------------------
   三条铁律（这个组件不造假）：
   1. 时钟 / 倒计时 / “数据截至 N 小时前” 全部来自真实时间；
   2. 连接数、数据文件变化、探活结果来自真实 SSE 服务；连不上就明说“静态快照”，
      不会偷偷用一个定时器把数字往上拨；
   3. 数字滚动只是呈现：目标值永远来自真实数据，动画不改事实。

   无依赖，ES5 语法，挂到 window.Live。
   页面接入：
     页面 head 引 assets/live.css，body 尾引 assets/live.js（引导脚本放它后面）
     Live.init({channel:'starta-live', pill:'#livePill', asOf:'2026-10-20T03:14:31+08:00'})
   ===================================================================== */
(function (global) {
  "use strict";

  var VERSION = "1.0.0";
  var doc = global.document;
  var reduce = false;
  try { reduce = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { reduce = false; }

  var cfg = {
    channel: "starta-live",
    server: "auto",       /* "auto" | "" | "http://127.0.0.1:8790" */
    asOf: null,           /* 真实数据采集时间：ISO 字符串 / 毫秒 / Date */
    pill: null,           /* 状态胶囊的容器：选择器或元素 */
    heartbeatEvery: 5000, /* 服务端心跳间隔（仅用于“心跳 N 秒前”的判定） */
    tabLabel: "页面",
    autostart: true
  };

  var state = {
    mode: "snapshot",     /* snapshot | sync | connecting | live | reconnecting */
    server: "",
    es: null,
    clients: 0,           /* 服务端在线页签数 */
    peers: {},            /* BroadcastChannel 同源页签：id -> lastSeen */
    since: 0,             /* 服务端启动时间 */
    asOf: 0,              /* 真实数据截至时间（毫秒） */
    lastBeat: 0,          /* 最近一次服务端心跳 */
    ready: false,
    opened: false,        /* 是否成功连上过实时服务（决定“连接中/重连中”） */
    gen: 0                /* 连接代号：手动 connect / 重连时作废旧 SSE 回调 */
  };

  /* null 原型：事件名可能来自服务端（任意字符串），用 {} 会让 "constructor" /
     "__proto__" 这类名字撞上 Object.prototype，dispatch 时直接抛 TypeError。 */
  var subs = Object.create(null);
  var timers = [];
  var tabId = "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  var bc = null;
  var LS_KEY = "__starta_live__";

  /* ---------------- 小工具 ---------------- */
  function elOf(x) {
    if (!x) return null;
    if (typeof x === "string") { try { return doc.querySelector(x); } catch (e) { return null; } }
    return x.nodeType === 1 ? x : null;
  }
  function fmtNum(n, dec) {
    dec = dec == null ? 0 : dec;
    var v = Number(n);
    if (!isFinite(v)) return String(n);
    try {
      return v.toLocaleString("zh-CN", { minimumFractionDigits: dec, maximumFractionDigits: dec });
    } catch (e) {
      var s = v.toFixed(dec), p = s.split(".");
      p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      return p.join(".");
    }
  }
  function pad2(n) { n = String(n); return n.length < 2 ? "0" + n : n; }
  function hms(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return pad2(Math.floor(s / 3600)) + ":" + pad2(Math.floor(s % 3600 / 60)) + ":" + pad2(s % 60);
  }
  function agoText(ms) {
    var s = Math.floor(ms / 1000);
    if (s < 0) s = 0;
    if (s < 5) return "刚刚";
    if (s < 60) return s + " 秒前";
    if (s < 3600) return Math.floor(s / 60) + " 分 " + (s % 60) + " 秒前";
    if (s < 86400) return Math.floor(s / 3600) + " 小时 " + Math.floor(s % 3600 / 60) + " 分前";
    return Math.floor(s / 86400) + " 天前";
  }
  /* 真实日期解析：只吃页面里真有的写法，猜不到就返回 NaN（显示“—”，绝不编时间）。
     "2026-10-26 17:00" → 本地时间；"10-26" → 今天之后最近的 10 月 26 日；"长期" → NaN */
  function toDate(str) {
    if (str == null || str === "") return NaN;
    if (str instanceof Date) return str.getTime();
    if (typeof str === "number") return str;
    var s = String(str).trim();
    if (!/\d/.test(s)) return NaN;
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
    if (m) {
      var d1 = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
      return isNaN(d1.getTime()) ? NaN : d1.getTime();
    }
    m = /^(\d{1,2})-(\d{1,2})$/.exec(s);
    if (m) {
      var now = new Date(), y = now.getFullYear();
      var d2 = new Date(y, Number(m[1]) - 1, Number(m[2]));
      if (d2.getTime() < new Date(y, now.getMonth(), now.getDate()).getTime()) d2 = new Date(y + 1, Number(m[1]) - 1, Number(m[2]));
      return d2.getTime();
    }
    var t = Date.parse(s.replace(" ", "T"));
    return t;
  }
  function alive(node) {
    if (!node) return false;
    if (typeof node.isConnected === "boolean") return node.isConnected;
    /* IE11 / 旧内核没有 isConnected：退回 DOM 树查询 */
    return !!(doc.documentElement && doc.documentElement.contains(node));
  }
  function dispatch(type, payload, from, noStar) {
    var base = Array.isArray(subs[type]) ? subs[type] : [];
    var list = base.slice();
    if (!noStar && type !== "*" && Array.isArray(subs["*"])) list = list.concat(subs["*"]);
    for (var i = 0; i < list.length; i++) {
      try { list[i](payload, type, from || "local"); } catch (e) { if (global.console) console.error("[Live]", e); }
    }
  }
  function every(ms, fn) { var t = setInterval(fn, ms); timers.push(t); return t; }

  /* ---------------- 状态胶囊 ---------------- */
  var pillEl = null, pillParts = null;
  function pillRender() {
    if (!pillEl) return;
    if (!pillParts) {
      pillEl.innerHTML =
        '<i class="live-dot" aria-hidden="true"></i>' +
        '<b class="live-state">快照</b>' +
        '<span class="live-sep" aria-hidden="true">·</span>' +
        '<span class="live-clock">--:--:--</span>' +
        '<span class="live-meta"></span>';
      pillParts = {
        state: pillEl.querySelector(".live-state"),
        clock: pillEl.querySelector(".live-clock"),
        meta: pillEl.querySelector(".live-meta")
      };
    }
    pillEl.className = "live-pill is-" + state.mode;
    var label = { live: "实时", sync: "同步", connecting: "连接中", reconnecting: "重连中", snapshot: "快照" }[state.mode] || "快照";
    pillParts.state.textContent = label;
    var meta = "";
    if (state.mode === "live") {
      meta = state.clients > 1 ? state.clients + " 端在线" : "已连接";
    } else if (state.mode === "sync") {
      var n = Object.keys(state.peers).length + 1;
      meta = n > 1 ? n + " 标签页同步" : "仅本页签 · 未连服务";
    } else if (state.mode === "snapshot") {
      meta = "静态数据";
    }
    pillParts.meta.textContent = meta ? " · " + meta : "";
    pillEl.title = pillTitle();
    pillEl.setAttribute("data-live-mode", state.mode);
    /* 页面重渲染会换掉胶囊 DOM：新时钟节点要立刻接上，否则停在 --:--:-- */
    if (pillParts && pillParts.clock && !pillParts.clock.__liveClockTimer) clock(pillParts.clock);
  }
  function pillTitle() {
    var parts = [];
    if (state.mode === "live") {
      parts.push("实时服务已连接：" + state.server);
      parts.push(state.clients + " 个页面在线");
      parts.push("心跳 " + (state.lastBeat ? agoText(Date.now() - state.lastBeat) : "等待首包"));
    } else if (state.mode === "sync") {
      parts.push("未连上实时服务，已降级为同源多标签同步");
      parts.push("时钟与倒计时来自真实时间，数字不做模拟滚动");
      if (state.serverTried) parts.push("尝试过：" + state.serverTried);
    } else if (state.mode === "snapshot") {
      parts.push("静态快照：本页数字来自真实数据，不模拟增长");
      if (state.asOf) parts.push("数据截至 " + new Date(state.asOf).toLocaleString("zh-CN") + "（" + agoText(Date.now() - state.asOf) + "）");
    } else {
      parts.push("正在连接实时服务…");
    }
    return parts.join(" · ");
  }
  function setMode(mode) {
    if (state.mode === mode) return;
    state.mode = mode;
    pillRender();
    dispatch("mode", { mode: mode, clients: state.clients, server: state.server }, "live");
  }

  /* ---------------- 同源页签在线（真实存在，不做假） ---------------- */
  function peersCount() { return Object.keys(state.peers).length + 1; }
  function presenceTick() {
    var now = Date.now();
    Object.keys(state.peers).forEach(function (id) { if (now - state.peers[id] > 12000) delete state.peers[id]; });
    broadcastRaw({ t: "presence", id: tabId, label: cfg.tabLabel, at: now });
    pillRender();
    dispatch("peers", { count: peersCount() }, "live");
  }

  /* ---------------- BroadcastChannel / storage 兜底 ---------------- */
  function broadcastRaw(msg) {
    msg.at = msg.at || Date.now();
    msg.from = tabId;
    try {
      if (bc) { bc.postMessage(msg); return; }
      localStorage.setItem(LS_KEY, JSON.stringify(msg));
      localStorage.removeItem(LS_KEY);
    } catch (e) { /* 忽略：隐私模式 / file:// 限制 */ }
  }
  function onChannel(msg) {
    if (!msg || msg.from === tabId) return;
    if (msg.t === "presence") {
      var isNew = !state.peers[msg.id];
      state.peers[msg.id] = msg.at || Date.now();
      if (isNew) { broadcastRaw({ t: "presence", id: tabId, label: cfg.tabLabel }); pillRender(); }
      dispatch("peers", { count: peersCount() }, "live");
      return;
    }
    dispatch(msg.t, msg.p, "peer");
  }
  function initChannel() {
    try {
      if (global.BroadcastChannel) {
        bc = new BroadcastChannel("starta-bc-" + cfg.channel);
        bc.onmessage = function (ev) { onChannel(ev.data); };
      }
    } catch (e) { bc = null; }
    global.addEventListener("storage", function (ev) {
      if (ev.key !== LS_KEY || !ev.newValue) return;
      try { onChannel(JSON.parse(ev.newValue)); } catch (e) { /* 忽略坏消息 */ }
    });
    global.addEventListener("starta:live", function (ev) { onChannel(ev.detail); });
  }

  /* ---------------- SSE：真连接，真推送 ---------------- */
  function resolveCandidates() {
    if (cfg.server && cfg.server !== "auto") return [String(cfg.server).replace(/\/$/, "")];
    var out = [];
    var proto = global.location ? global.location.protocol : "";
    var port = global.location ? global.location.port : "";
    var host = global.location ? global.location.hostname : "";
    if (proto === "http:" || proto === "https:") {
      if (port === "8790") out.push(global.location.origin);
      else if (proto === "http:" && (host === "127.0.0.1" || host === "localhost")) out.push(global.location.origin);
      /* https 页面不能连 http://127.0.0.1（混合内容会被浏览器拦掉），
         只试同源，避免控制台一堆无意义的红字。 */
      if (proto === "http:" && port !== "8790") out.push("http://127.0.0.1:8790");
    } else if (proto === "file:") {
      out.push("http://127.0.0.1:8790");
    }
    return out;
  }
  function connect() {
    var candidates = resolveCandidates();
    state.serverTried = candidates.join(" / ");
    if (!candidates.length) { setMode("sync"); return; }
    /* 新一轮连接先掐掉旧的 SSE 和待执行的退避定时器：
       否则手动 connect() / 重复 init 会让旧连接继续挂着，服务端在线数虚高、事件重复。 */
    var gen = (state.gen || 0) + 1;
    state.gen = gen;
    if (state.es) { try { state.es.close(); } catch (e) { } state.es = null; }
    if (state.retryTimer) { clearTimeout(state.retryTimer); state.retryTimer = 0; }
    setMode(state.opened ? "reconnecting" : "connecting");
    var idx = 0;
    (function next() {
      if (gen !== state.gen) return;
      if (idx >= candidates.length) {
        setMode("sync");
        scheduleRetry();
        return;
      }
      var base = candidates[idx++];
      var es;
      try { es = new global.EventSource(base + "/live/stream?ch=" + encodeURIComponent(cfg.channel) + "&tab=" + tabId); }
      catch (e) { next(); return; }
      var opened = false;
      var guard = setTimeout(function () {
        if (opened || gen !== state.gen) return;
        try { es.close(); } catch (e) { }
        next();
      }, 2600);
      es.onopen = function () {
        /* 这条连接已经被新一轮 connect() 取代：安静关掉，不要污染新状态 */
        if (gen !== state.gen) { try { es.close(); } catch (e) { } return; }
        opened = true;
        clearTimeout(guard);
        state.opened = true;
        state.es = es;
        state.server = base;
        state.ready = true;
        state.retry = 0;
        setMode("live");
      };
      es.onmessage = function (ev) {
        if (gen !== state.gen) return;
        var msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        handleServer(msg);
      };
      es.onerror = function () {
        if (gen !== state.gen) { try { es.close(); } catch (e) { } return; }
        clearTimeout(guard);
        try { es.close(); } catch (e) { }
        if (state.es === es) state.es = null;
        if (opened) { setMode("reconnecting"); scheduleRetry(); }
        else next();
      };
    })();
  }
  function scheduleRetry() {
    if (state.retryTimer) return;
    state.retry = (state.retry || 0) + 1;
    var wait = Math.min(30000, 4000 * state.retry);
    state.retryTimer = setTimeout(function () {
      state.retryTimer = 0;
      connect();
    }, wait);
  }
  function handleServer(msg) {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case "hello":
        state.clients = Number(msg.clients) || state.clients;
        state.since = Number(msg.since) || 0;
        /* 页面自己带着“真实写入时间”的（双端状态存 localStorage），保留页面口径 */
        if (msg.asOf && !cfg.localAsOf) state.asOf = Number(msg.asOf) || state.asOf;
        state.lastBeat = Date.now();
        pillRender();
        dispatch("hello", msg, "server");
        break;
      case "clients":
        state.clients = Number(msg.n) || 0;
        pillRender();
        dispatch("clients", { count: state.clients }, "server");
        break;
      case "heartbeat":
        state.lastBeat = Date.now();
        dispatch("heartbeat", msg, "server");
        break;
      case "data":
        /* 数据文件变了：同步“数据截至”的真实时间，别让页面停在旧扫描时间 */
        if (msg.asOf && !cfg.localAsOf) { state.asOf = Number(msg.asOf) || state.asOf; pillRender(); }
        dispatch("data", msg, "server");
        break;
      case "session":
        dispatch("session", msg, "server");
        break;
      case "event":
        /* 统一约定：on('event', fn) 拿到完整信封（含 name / at / replay）；
           on('<name>', fn) 拿到其中的 payload。 */
        dispatch("event", msg, "server");
        if (msg.name && msg.name !== "event") dispatch(msg.name, msg.payload, "server", true);
        break;
      default:
        dispatch(msg.type, msg, "server");
    }
  }

  /* ---------------- 真实的“N 分钟前” ---------------- */
  var agoBinds = [];
  function el(x) { return typeof x === "string" ? document.querySelector(x) : x; }
  function bindAgo(node, ts, opts) {
    node = el(node);
    if (!node) return null;
    opts = opts || {};
    var prefix = opts.prefix == null ? "" : opts.prefix;
    if (node.__liveTimer) clearInterval(node.__liveTimer);
    function paint() {
      if (!alive(node)) { clearInterval(node.__liveTimer); node.__liveTimer = null; return; }
      var t = typeof ts === "function" ? ts() : ts;
      if (t == null || t === "") { node.textContent = opts.emptyText || prefix + "—"; node.removeAttribute("data-live-ago"); return; }
      var ms = typeof t === "number" ? t : toDate(t);
      if (!isFinite(ms)) { node.textContent = opts.emptyText || prefix + "—"; node.removeAttribute("data-live-ago"); return; }
      node.textContent = prefix + agoText(Date.now() - ms);
      node.title = new Date(ms).toLocaleString("zh-CN") + "（真实记录时间）";
      node.setAttribute("data-live-ago", String(ms));
    }
    paint();
    var timer = every(1000, paint);
    node.__liveTimer = timer;
    agoBinds.push({ node: node, timer: timer, paint: paint });
    return { refresh: paint };
  }

  /* ---------------- 真实倒计时（到真实截止时间） ---------------- */
  var cdBinds = [];
  function bindCountdown(node, deadline, opts) {
    node = el(node);
    if (!node) return null;
    opts = opts || {};
    var ms = typeof deadline === "number" ? deadline : toDate(deadline);
    if (node.__liveTimer) clearInterval(node.__liveTimer);
    function paint() {
      if (!alive(node)) { clearInterval(node.__liveTimer); node.__liveTimer = null; return; }
      if (!isFinite(ms)) { node.textContent = "—"; return; }
      var left = ms - Date.now();
      if (left <= 0) {
        node.textContent = opts.expiredText || "已截止";
        node.setAttribute("data-live-over", "1");
        node.className = (node.className.replace(/\s*is-hot|\s*is-over/g, "")) + " is-over";
        return;
      }
      node.removeAttribute("data-live-over");
      var s = Math.floor(left / 1000);
      var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
      var txt = (d > 0 ? d + " 天 " : "") + pad2(h) + ":" + pad2(m) + ":" + pad2(sec);
      node.textContent = (opts.prefix || "") + txt;
      var cls = node.className.replace(/\s*is-hot|\s*is-over/g, "");
      node.className = cls + (left < 86400000 ? " is-hot" : "");
      node.title = "真实截止时间：" + new Date(ms).toLocaleString("zh-CN");
    }
    paint();
    var timer = every(1000, paint);
    node.__liveTimer = timer;
    cdBinds.push({ node: node, timer: timer, paint: paint });
    return { refresh: paint };
  }

  /* ---------------- 数字滚动（呈现层：目标值来自真实数据） ---------------- */
  function parseNum(text) {
    var v = String(text == null ? "" : text).replace(/[^\d.-]/g, "");
    var n = parseFloat(v);
    return isFinite(n) ? n : NaN;
  }
  function tween(node, target, opts) {
    opts = opts || {};
    var dec = opts.decimals == null ? (String(target).indexOf(".") >= 0 ? 1 : 0) : opts.decimals;
    var from = opts.from != null ? Number(opts.from) : node.__liveVal;
    if (from == null) from = parseNum(node.textContent);
    if (!isFinite(from)) from = 0;
    node.__liveVal = target;
    node.__liveTarget = target;
    var dur = opts.duration == null ? 720 : opts.duration;
    var start = null;
    var delta = target - from;
    if (opts.instant || reduce || dur <= 0 || !delta) {
      node.textContent = fmtNum(target, dec);
      node.classList.add("live-num");
      return;
    }
    if (node.__liveRAF) { cancelAnimationFrame(node.__liveRAF); node.__liveRAF = 0; }
    node.classList.add("live-num");
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min(1, (ts - start) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      node.textContent = fmtNum(from + delta * e, dec);
      if (p < 1) { node.__liveRAF = requestAnimationFrame(step); }
      else {
        node.__liveRAF = 0;
        node.textContent = fmtNum(target, dec);
        node.classList.remove("live-bump");
        void node.offsetWidth;
        node.classList.add("live-bump");
      }
    }
    node.__liveRAF = requestAnimationFrame(step);
  }
  function num(x, value, opts) {
    var node = elOf(x);
    if (!node) return;
    opts = opts || {};
    if (typeof value === "string" && !/[0-9]/.test(value)) { node.textContent = value; return; }
    var target = Number(value);
    if (!isFinite(target)) { node.textContent = String(value); return; }
    tween(node, target, opts);
  }
  function autoNum(root) {
    var scope = root ? elOf(root) : doc;
    if (!scope) return;
    var nodes = scope.querySelectorAll("[data-live-num]");
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var raw = n.getAttribute("data-live-value");
      if (raw == null) raw = n.getAttribute("data-live-num");
      var v = Number(raw);
      if (!isFinite(v)) continue;
      var from = n.getAttribute("data-live-from");
      num(n, v, { decimals: Number(n.getAttribute("data-live-dec") || 0), from: from != null ? Number(from) : undefined });
    }
  }

  /* ---------------- 数字增量提示（真实 +N/-N） ---------------- */
  function delta(x, amount, opts) {
    var node = elOf(x);
    if (!node) return;
    var n = Number(amount);
    if (!isFinite(n) || !n) return;
    opts = opts || {};
    var host = node.parentNode;
    if (!host) return;
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    var span = doc.createElement("span");
    span.className = "live-delta " + (n > 0 ? "up" : "down");
    span.textContent = (n > 0 ? "+" : "") + n;
    host.appendChild(span);
    setTimeout(function () { if (span.parentNode) span.parentNode.removeChild(span); }, opts.ttl || 1600);
  }

  /* ---------------- 时钟（真实本地时间） ---------------- */
  function clock(x, opts) {
    var node = elOf(x);
    if (!node) return;
    opts = opts || {};
    /* 同一个节点重复绑（页面重渲染、胶囊重建）先掐掉旧定时器，别越积越多 */
    if (node.__liveClockTimer) { clearInterval(node.__liveClockTimer); node.__liveClockTimer = null; }
    function paint() {
      if (!alive(node)) { clearInterval(node.__liveClockTimer); node.__liveClockTimer = null; return; }
      var d = new Date();
      var s = pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + (opts.seconds === false ? "" : ":" + pad2(d.getSeconds()));
      node.textContent = s;
      if (opts.date) {
        node.title = d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }) + " " + s;
      }
    }
    paint();
    node.__liveClockTimer = setInterval(paint, 1000);
    return { refresh: paint, stop: function () { clearInterval(node.__liveClockTimer); node.__liveClockTimer = null; } };
  }

  /* ---------------- 初始化 ---------------- */
  function init(opts) {
    opts = opts || {};
    for (var k in opts) if (opts.hasOwnProperty(k)) cfg[k] = opts[k];
    if (cfg.asOf) {
      var t = typeof cfg.asOf === "number" ? cfg.asOf : Date.parse(cfg.asOf);
      state.asOf = isFinite(t) ? t : 0;
    }
    if (cfg.localAsOf) cfg.localAsOf = true;
    if (state.ready) return Live;
    state.ready = true;
    state.readyAt = Date.now();

    initChannel();
    presenceTick();
    every(5000, presenceTick);

    pillEl = elOf(cfg.pill);
    if (pillEl) { pillRender(); clock(pillEl.querySelector(".live-clock") || (function () { pillRender(); return pillEl.querySelector(".live-clock"); })()); }

    if (cfg.autostart) connect();
    autoNum(doc);
    /* 推迟一个 tick：让页面在 init() 之后挂的监听也能收到 ready */
    setTimeout(function () { dispatch("ready", { version: VERSION }, "local"); }, 0);
    return Live;
  }

  /* ---------------- 对外 API ---------------- */
  var Live = {
    version: VERSION,
    init: init,
    on: function (type, fn) {
      (subs[type] = subs[type] || []).push(fn);
      return function () { Live.off(type, fn); };
    },
    off: function (type, fn) {
      var list = subs[type];
      if (!list) return;
      var i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    emit: function (type, payload) {
      broadcastRaw({ t: type, p: payload });
      dispatch(type, payload, "local");
    },
    /* 服务端事件 → 页面的统一入口：Live.event('session', fn) 等价于 on */
    event: function (type, fn) { return Live.on(type, fn); },
    /* 数字 */
    num: num,
    fmt: fmtNum,
    delta: delta,
    autonum: autoNum,
    autoNum: autoNum,
    /* 时间 */
    clock: clock,
    toDate: toDate,
    ago: bindAgo,
    countdown: bindCountdown,
    /* 状态 */
    state: function () { return { mode: state.mode, clients: state.clients, peers: peersCount(), server: state.server, asOf: state.asOf, since: state.since, lastBeat: state.lastBeat }; },
    mode: function () { return state.mode; },
    tabId: tabId,
    /* 手动 */
    connect: connect,
    pill: function (x) {
      var prev = pillEl; cfg.pill = x; pillEl = elOf(x); pillParts = null;
      pillRender();
      if (pillParts && pillParts.clock) clock(pillParts.clock);
      return prev;
    },
    /* 供页面自定义：手动注入一条“同源实时”事件（仍会广播到其它标签页） */
    ping: function () { presenceTick(); return true; }
  };

  global.Live = Live;

  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", function () { autoNum(doc); });
  }
})(typeof window !== "undefined" ? window : this);
