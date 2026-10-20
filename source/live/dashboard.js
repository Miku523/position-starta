/* 星他 STARTA · 实时大屏逻辑（数据全部来自本机服务，前端不做任何模拟） */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var baseUp = 0, upAt = 0;
  var evCount = 0;

  Live.init({ channel: "starta-live", pill: "#livePill", server: "auto", tabLabel: "大屏" });

  /* ---------- 运行时长：服务端给基准，本地按秒推进（仍是真的时间） ---------- */
  function setUptime(ms) {
    baseUp = ms || 0;
    upAt = Date.now();
    paintUp();
  }
  function paintUp() {
    var ms = baseUp + (Date.now() - upAt);
    var s = Math.floor(ms / 1000);
    var h = String(Math.floor(s / 3600)).padStart(2, "0");
    var m = String(Math.floor(s % 3600 / 60)).padStart(2, "0");
    var sec = String(s % 60).padStart(2, "0");
    $("mUp").textContent = h + ":" + m + ":" + sec;
  }
  setInterval(paintUp, 1000);

  /* ---------- 指标 ---------- */
  function setNum(id, v) { Live.num($(id), v || 0); }
  function applyTotals(t, files) {
    if (!t) return;
    setNum("mPos", t.positions);
    setNum("mEmp", t.employers);
    setNum("mHire", t.hires);
    setNum("mSub", t.submits);
    if (files) renderFiles(files);
    $("mSubSrc").textContent = "会话台账 " + Live.fmt(t.sessions || 0) + " 行";
  }
  function renderFiles(files) {
    var tb = $("fileRows");
    if (!files || !files.length) return;
    tb.innerHTML = files.map(function (f) {
      if (f.missing) {
        return '<tr><td class="b">' + f.name + '</td><td colspan="4" class="empty">缺失 ' + (f.error || "") + '</td></tr>';
      }
      var age = Date.now() - (f.mtime || 0);
      var stale = age > 7 * 86400000 ? " stale" : "";
      return '<tr>' +
        '<td class="b">' + f.name + '</td>' +
        '<td class="b">' + Live.fmt(f.rows) + '</td>' +
        '<td>' + bytes(f.bytes) + '</td>' +
        '<td>' + new Date(f.mtime).toLocaleString("zh-CN", { hour12: false }) + '</td>' +
        '<td><span class="fresh' + stale + '"><i></i><span data-age="' + f.mtime + '"></span></span></td>' +
        '</tr>';
    }).join("");
    [].forEach.call(tb.querySelectorAll("[data-age]"), function (n) {
      Live.ago(n, Number(n.getAttribute("data-age")), { prefix: "" });
    });
  }
  function bytes(n) {
    if (!n) return "—";
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    return (n / 1048576).toFixed(2) + " MB";
  }
  function setClients(n) {
    setNum("mClients", n);
    $("mClientsSrc").textContent = n > 1 ? "SSE 长连接 · 多端" : "SSE 长连接";
  }
  function setBeat(beat) {
    $("mBeat").textContent = Live.fmt(beat) + " 次心跳 · 每 4 秒";
  }

  /* ---------- 事件流 ---------- */
  function addEvent(ev, replay) {
    var box = $("events");
    var empty = box.querySelector(".empty");
    if (empty) empty.parentNode.removeChild(empty);
    var row = document.createElement("div");
    row.className = "ev" + (replay ? " replay" : "");
    var payload = ev.payload == null ? "" : JSON.stringify(ev.payload);
    if (payload.length > 90) payload = payload.slice(0, 89) + "…";
    row.innerHTML = '<time>' + new Date(ev.at).toLocaleTimeString("zh-CN", { hour12: false }) + '</time>' +
      '<span class="name"><b>' + ev.name + '</b>' + esc(payload) + '</span>' +
      '<span class="who">' + (ev.replay ? "回放" : "实时") + '</span>';
    box.insertBefore(row, box.firstChild);
    while (box.children.length > 40) box.removeChild(box.lastChild);
    evCount++;
    $("evCount").textContent = Live.fmt(evCount) + " 条" + (evCount > 1 ? "（含回放）" : "");
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }

  /* ---------- 体检 ---------- */
  function loadHealth() {
    fetch("/live/health", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        $("chkTime").textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false }) + " 体检";
        $("health").innerHTML = (j.checks || []).map(function (c) {
          return '<div class="chk ' + (c.ok ? "ok" : "bad") + '"><i>' + (c.ok ? "✓" : "!") + '</i>' +
            '<span>' + c.name + '</span><span class="det" title="' + esc(c.detail) + '">' + esc(c.detail) + '</span></div>';
        }).join("") || '<div class="empty">体检没有返回检查项</div>';
      })
      .catch(function () {
        $("health").innerHTML = '<div class="empty">连不上体检接口（服务已停？）</div>';
      });
  }

  /* ---------- 状态 ---------- */
  function footText() {
    var m = Live.mode();
    if (m === "live") {
      $("footState").textContent = "实时连接中 · " + Live.state().server + " · 心跳与在线数由服务端推送";
    } else if (m === "sync") {
      $("footState").textContent = "静态快照（服务未连上）· 大屏数字来自真实 CSV，不模拟增长";
    } else if (m === "snapshot") {
      $("footState").textContent = "静态快照：页面数字来自真实数据文件，不模拟增长";
    } else {
      $("footState").textContent = "正在连接实时服务…";
    }
  }
  Live.on("mode", footText);
  Live.on("heartbeat", function (ev) {
    setUptime(ev.uptimeMs);
    setBeat(ev.beat);
    setClients(ev.clients);
  });
  Live.on("clients", function (p) { setClients(p.count); });
  Live.on("data", function (ev) { applyTotals(ev.totals, ev.files); });
  Live.on("event", function (ev) { addEvent(ev, ev.replay); });
  Live.on("hello", function (ev) {
    if (ev && ev.data) {
      applyTotals(ev.data, ev.data.files);
      $("mPosSrc").textContent = "真解析 CSV · " + (ev.data.files && ev.data.files[0] ? bytes(ev.data.files[0].bytes) : "");
    }
    if (ev && ev.since) setUptime(Date.now() - ev.since);
    if (ev && ev.beat) setBeat(ev.beat);
    if (ev && ev.clients) setClients(ev.clients);
  });
  Live.on("ready", function () {
    /* 初始数字走 SSE 的 hello（不用额外 fetch：同源 6 条 HTTP/1.1 连接会被多个页签的 SSE 占满） */
    loadHealth();
    setInterval(loadHealth, 10000);
    footText();
  });
})();
