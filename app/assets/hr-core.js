/* =====================================================================
   星他 STARTA · HR 能力层（v1.1）
   ---------------------------------------------------------------------
   这个文件只做底座，不渲染任何业务视图：
     · 角色与权限（hr / manager / viewer）         HR.role / canWrite / canNote
     · 本地数据仓库（职位、人才、规则、审计）       HR.jd / HR.talent / HR.rules / HR.audit
     · 提醒引擎（新公告 / 对标截止 / JD 风险 / 跟进） HR.notifications / HR.unread
     · 顶栏铃铛 + 侧栏角色菜单 + 状态栏文案          HR.toggleBell / HR.mountChrome
     · 视图注册表（由 hr-views-*.js 填充）           HR.views / HR.render

   与 app.js 的耦合只有 5 个既定补丁（见 qa-report v1.1）：
     1) VIEW_LABEL 增加 jd / talent / watch / brief / settings
     2) setView() 末尾调用 HR.render(v)
     3) syncStatusText() 对未知视图回退到 HR.statusText(v)
     4) #bellBtn 点击改为 HR.toggleBell()
     5) setSaved() / setStage() 写审计 HR.audit()

   存储：localStorage['starta-hr-v1']；与 app.js 的
   strata-wb-bench（对标清单）只读兼容，互不改写。
   ===================================================================== */
(function () {
  "use strict";

  /* ---------------- 基础工具 ---------------- */
  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmt(n) {
    var v = Number(n);
    return isFinite(v) ? v.toLocaleString("zh-CN") : "—";
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function todayDate() {
    var d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function isoDate(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function isoMinute(d) {
    d = d || new Date();
    return isoDate(d) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  function parseISO(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  function daysFrom(iso) {
    var d = parseISO(iso);
    if (!d) return null;
    return Math.round((d - todayDate()) / 86400000);
  }
  function atLabel(at) {
    var s = String(at || "");
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) return s;
    return m[2] + "-" + m[3];
  }
  function uid(prefix) {
    return String(prefix || "id") + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  function toast(m) {
    if (typeof window.toast === "function") { window.toast(m); return; }
    console.log("[HR]", m);
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;left:-9999px;top:0";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }
  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
  }
  function csvCell(v) {
    var s = String(v == null ? "" : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csvLine(arr) { return arr.map(csvCell).join(","); }

  /* ---------------- 图标（内联 SVG，颜色跟随 currentColor） ---------------- */
  var ICONS = {
    doc: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/>',
    list: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    alert: '<path d="M12 3 2 21h20L12 3z"/><path d="M12 9v5M12 17.5v.01"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
    bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10.3 21a2 2 0 0 0 3.4 0"/>',
    brief: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 12h8M8 16h8M8 8h2"/>',
    settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>',
    edit: '<path d="M4 20h4L20 8l-4-4L4 16z"/>',
    download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    print: '<path d="M7 8V3h10v5"/><rect x="4" y="8" width="16" height="9" rx="2"/><path d="M7 17h10v4H7z"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    check: '<path d="m5 12 4.5 5L19 7"/>',
    play: '<path d="M8 5v14l11-7z"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    upload: '<path d="M12 21V9m0 0 4 4m-4-4-4 4"/><path d="M4 4h16"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>'
  };
  function icon(name, size) {
    var body = ICONS[name] || ICONS.doc;
    var s = size || 16;
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + "</svg>";
  }

  /* ---------------- 常量 ---------------- */
  var HR_KEY = "starta-hr-v1";
  var BENCH_KEY = "strata-wb-bench";

  var ROLES = [
    { k: "hr", lb: "招聘负责人", tag: "HR", desc: "建职位、导人才、改提醒规则、出简报", write: true, note: true },
    { k: "manager", lb: "用人经理", tag: "MGR", desc: "看全部数据、给候选人加备注，不改配置", write: false, note: true },
    { k: "viewer", lb: "只读观察者", tag: "VIEW", desc: "只读。适合老板、财务或外部协作方", write: false, note: false }
  ];

  var JD_STATUS = {
    draft: { lb: "草稿", tone: "" },
    live: { lb: "在招", tone: "ok" },
    closed: { lb: "已关闭", tone: "" }
  };

  var TALENT_STAGES = [
    { k: "new", lb: "待初筛" },
    { k: "screen", lb: "初筛通过" },
    { k: "interview", lb: "面试中" },
    { k: "offer", lb: "已发 Offer" },
    { k: "hired", lb: "已入职" },
    { k: "rejected", lb: "已淘汰" }
  ];

  var STAGE_LB = {
    saved: "待研判", applied: "已对标", written: "已进简报", interview: "已汇报", result: "已落地"
  };

  var DEFAULT_RULES = [
    { id: "rule-unit-gz", type: "unit", value: "广州", enabled: true },
    { id: "rule-kw-lin", type: "keyword", value: "林学", enabled: true }
  ];

  var VIEW_LB = {
    jd: "我的职位", talent: "人才库", watch: "变化提醒", brief: "对标简报", settings: "设置与合规"
  };

  /* ---------------- 数据门面（只读） ---------------- */
  function S() { return window.STARTA || {}; }
  function DATA() { return (window.STARTA && window.STARTA.DATA) || []; }
  function NOTICES() { return (window.STARTA && window.STARTA.NOTICES) || []; }
  function META() { return (window.STARTA && window.STARTA.META) || {}; }

  var _posById = null;
  function posById(i) {
    if (!_posById) {
      _posById = new Map();
      DATA().forEach(function (d) { _posById.set(d.i, d); });
    }
    return _posById.get(Number(i)) || null;
  }
  var _noticeById = null;
  function noticeById(id) {
    if (!_noticeById) {
      _noticeById = new Map();
      NOTICES().forEach(function (n) { _noticeById.set(n.id, n); });
    }
    return _noticeById.get(id) || null;
  }

  /* ---------------- 本地状态 ---------------- */
  function defaults() {
    return {
      v: 1,
      booted: false,
      profile: { name: "陈晓", org: "星他科技", city: "广州" },
      role: "hr",
      jd: [],
      talent: [],
      rules: DEFAULT_RULES.map(function (r) { return { id: r.id, type: r.type, value: r.value, enabled: r.enabled }; }),
      audit: [],
      seen: { notif: [], jobs: null },
      lastVisit: "",
      createdAt: isoDate()
    };
  }
  function mergeState(base, raw) {
    if (!raw || typeof raw !== "object") return base;
    if (raw.profile && typeof raw.profile === "object") {
      ["name", "org", "city"].forEach(function (k) {
        if (typeof raw.profile[k] === "string" && raw.profile[k]) base.profile[k] = raw.profile[k];
      });
    }
    if (ROLES.some(function (r) { return r.k === raw.role; })) base.role = raw.role;
    if (Array.isArray(raw.jd)) base.jd = raw.jd.filter(function (x) { return x && x.id && x.title; });
    if (Array.isArray(raw.talent)) base.talent = raw.talent.filter(function (x) { return x && x.id && x.name; });
    if (Array.isArray(raw.rules) && raw.rules.length) {
      base.rules = raw.rules.filter(function (r) { return r && r.type && r.value; }).map(function (r) {
        return { id: r.id || uid("rule"), type: r.type, value: String(r.value), enabled: r.enabled !== false };
      });
    }
    if (Array.isArray(raw.audit)) base.audit = raw.audit.slice(0, 200);
    if (raw.seen && typeof raw.seen === "object") {
      if (Array.isArray(raw.seen.notif)) base.seen.notif = raw.seen.notif.slice(0, 300);
      if (typeof raw.seen.jobs === "number") base.seen.jobs = raw.seen.jobs;
    }
    if (typeof raw.booted === "boolean") base.booted = raw.booted;
    if (typeof raw.lastVisit === "string") base.lastVisit = raw.lastVisit;
    if (typeof raw.createdAt === "string") base.createdAt = raw.createdAt;
    return base;
  }
  function loadState() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(HR_KEY) || "null"); } catch (e) { raw = null; }
    return mergeState(defaults(), raw);
  }
  var state = loadState();

  function persist() {
    try { localStorage.setItem(HR_KEY, JSON.stringify(state)); } catch (e) { /* 隐私模式忽略 */ }
  }

  function roleObj() {
    var r = ROLES.filter(function (x) { return x.k === state.role; })[0];
    return r || ROLES[0];
  }
  function canWrite() { return roleObj().write; }
  function canNote() { return roleObj().note; }
  function requireWrite() {
    if (canWrite()) return true;
    toast("当前角色「" + roleObj().lb + "」只读，不能修改。切到「招聘负责人」再试。");
    return false;
  }

  function audit(action, detail, view) {
    var r = roleObj();
    state.audit.unshift({
      at: isoMinute(),
      actor: state.profile.name,
      role: r.k,
      roleLb: r.lb,
      action: action || "",
      detail: detail || "",
      view: view || ""
    });
    if (state.audit.length > 200) state.audit.length = 200;
    persist();
  }

  /* ---------------- 对标清单（只读 app.js 的存储） ---------------- */
  function bench() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(BENCH_KEY) || "null"); } catch (e) { raw = null; }
    var list = [], prog = {};
    if (Array.isArray(raw)) list = raw;
    else if (raw && typeof raw === "object") {
      list = Array.isArray(raw.list) ? raw.list : [];
      prog = raw.prog || {};
    }
    var rows = [], seen = {};
    list.forEach(function (v) {
      var i = Number(v);
      if (!isFinite(i) || seen[i]) return;
      var d = posById(i);
      if (!d) return;
      seen[i] = 1;
      rows.push(d);
    });
    return { rows: rows, prog: prog };
  }
  function benchStage(i, prog) {
    var p = (prog || {})[i];
    return (p && p.st) || "saved";
  }

  /* ---------------- 规则 ---------------- */
  function rules() { return state.rules; }
  function ruleRows(rule) {
    if (!rule) return [];
    var v = String(rule.value || "").trim();
    if (!v) return [];
    var key = v.toLowerCase();
    return DATA().filter(function (d) {
      if (rule.type === "unit") return String(d.u || "").toLowerCase().indexOf(key) >= 0;
      if (rule.type === "region") return String(d.city || "").toLowerCase().indexOf(key) >= 0;
      return (String(d.r || "") + " " + String(d.u || "") + " " + String(d.m || "")).toLowerCase().indexOf(key) >= 0;
    });
  }
  function addRule(type, value) {
    if (!requireWrite()) return false;
    value = String(value || "").trim();
    if (!value) { toast("规则内容不能为空"); return false; }
    if (state.rules.some(function (r) { return r.type === type && r.value === value; })) {
      toast("同样的规则已经有了");
      return false;
    }
    state.rules.push({ id: uid("rule"), type: type, value: value, enabled: true });
    persist();
    audit("新增提醒规则", type + "：" + value, "watch");
    return true;
  }
  function toggleRule(id) {
    if (!requireWrite()) return false;
    var r = state.rules.filter(function (x) { return x.id === id; })[0];
    if (!r) return false;
    r.enabled = !r.enabled;
    persist();
    audit(r.enabled ? "启用提醒规则" : "暂停提醒规则", r.type + "：" + r.value, "watch");
    return true;
  }
  function removeRule(id) {
    if (!requireWrite()) return false;
    var r = state.rules.filter(function (x) { return x.id === id; })[0];
    state.rules = state.rules.filter(function (x) { return x.id !== id; });
    persist();
    if (r) audit("删除提醒规则", r.type + "：" + r.value, "watch");
    return true;
  }

  /* ---------------- 提醒引擎 ---------------- */
  function seenSet() {
    var m = {};
    (state.seen.notif || []).forEach(function (id) { m[id] = 1; });
    return m;
  }
  function markSeen(id) {
    if (!id) return;
    if (!state.seen.notif) state.seen.notif = [];
    if (state.seen.notif.indexOf(id) < 0) state.seen.notif.push(id);
    if (state.seen.notif.length > 300) state.seen.notif = state.seen.notif.slice(-300);
    persist();
  }
  function markAllSeen() {
    var ids = notifications().map(function (n) { return n.id; });
    state.seen.notif = (state.seen.notif || []).concat(ids).slice(-300);
    persist();
  }

  function notifications() {
    var out = [];
    var seen = seenSet();
    var today = isoDate(new Date());

    /* 1) 新公告：发布 7 天内且未读 */
    NOTICES().forEach(function (n) {
      var key = "notice:" + n.id;
      if (seen[key]) return;
      var age = daysFrom(n.published);
      if (age != null && age > 7) return;
      var rows = Number(n.rows) || 0;
      out.push({
        id: key, kind: "notice", tone: "info",
        title: "新公告 · " + (rows ? fmt(rows) + " 个岗位" : "岗位表待解析"),
        desc: (n.title || "") + "（" + (n.org || "发布单位") + " · " + (n.published || "—") + "）",
        at: n.published, view: "collect", param: n.id, icon: "doc"
      });
    });

    /* 2) 岗位库增量：与上次看到的条数比 */
    var total = DATA().length;
    if (state.seen.jobs != null && total > state.seen.jobs) {
      var key2 = "jobs:" + state.seen.jobs + ":" + total;
      if (!seen[key2]) {
        out.push({
          id: key2, kind: "jobs", tone: "info",
          title: "岗位库新增 " + fmt(total - state.seen.jobs) + " 条",
          desc: "上次 " + fmt(state.seen.jobs) + " 条 → 现在 " + fmt(total) + " 条（快照 " + (META().snapshot || today) + "）",
          at: META().snapshot, view: "lib", param: "", icon: "list"
        });
      }
    }

    /* 3) 对标清单里 7 天内截止的岗位 */
    var b = bench();
    b.rows.forEach(function (d) {
      var left = d.left;
      if (left == null || left < 0 || left > 7) return;
      var key3 = "dl:" + d.i;
      if (seen[key3]) return;
      out.push({
        id: key3, kind: "deadline", tone: left <= 3 ? "warn" : "info",
        title: "对标岗位即将截止 · 剩 " + left + " 天",
        desc: [d.u, d.r, d.end ? "截止 " + d.end : "", "阶段 " + (STAGE_LB[benchStage(d.i, b.prog)] || "待研判")].filter(Boolean).join(" · "),
        at: d.end, view: "mine", param: String(d.i), icon: "clock"
      });
    });

    /* 4) 在招职位的门槛风险（由 hr-market 计算） */
    if (window.HR && HR.market && typeof HR.market.gap === "function") {
      state.jd.forEach(function (j) {
        if (j.status !== "live") return;
        var g = null;
        try { g = HR.market.gap(j); } catch (e) { g = null; }
        if (!g || !g.flags || !g.flags.length) return;
        var key4 = "jd:" + j.id + ":" + g.level;
        if (seen[key4]) return;
        out.push({
          id: key4, kind: "jd", tone: "warn",
          title: "JD 门槛偏高 · " + j.title,
          desc: g.summary || g.flags.join("；"),
          at: j.updated || "", view: "jd", param: j.id, icon: "alert"
        });
      });
    }

    /* 5) 待初筛超过 2 天的候选人 */
    state.talent.forEach(function (t) {
      if (t.stage !== "new") return;
      var age = daysFrom(t.updated);
      if (age == null || age < 2) return;
      var key5 = "talent:" + t.id;
      if (seen[key5]) return;
      out.push({
        id: key5, kind: "talent", tone: "warn",
        title: "候选人待初筛 · " + t.name,
        desc: [t.jobTitle || "未关联职位", "来源 " + (t.source || "手动录入"), "已等待 " + age + " 天"].join(" · "),
        at: t.updated, view: "talent", param: t.id, icon: "user"
      });
    });

    out.sort(function (a, b2) {
      var w = (a.tone === "warn" ? 0 : 1) - (b2.tone === "warn" ? 0 : 1);
      if (w) return w;
      return String(b2.at || "").localeCompare(String(a.at || ""));
    });
    return out;
  }

  function unread() { return notifications().length; }

  function refreshCounts() {
    var live = state.jd.filter(function (j) { return j.status === "live"; }).length;
    var jdCt = document.getElementById("ctJd");
    if (jdCt) jdCt.textContent = state.jd.length ? String(live) + "/" + String(state.jd.length) : "—";
    var tCt = document.getElementById("ctTalent");
    if (tCt) tCt.textContent = state.talent.length ? String(state.talent.length) : "—";
  }

  function refreshBell() {
    var n = unread();
    var btn = document.getElementById("bellBtn");
    if (btn) {
      var dot = btn.querySelector(".hr-bdot");
      if (!dot) {
        dot = document.createElement("span");
        dot.className = "hr-bdot";
        dot.setAttribute("aria-hidden", "true");
        btn.appendChild(dot);
      }
      dot.hidden = n === 0;
      dot.textContent = n > 9 ? "9+" : String(n);
      btn.setAttribute("aria-label", n ? "提醒，有 " + n + " 条未读" : "提醒");
      btn.setAttribute("title", n ? "提醒 · " + n + " 条未读" : "提醒");
    }
    var wCt = document.getElementById("ctWatch");
    if (wCt) wCt.textContent = n ? String(n) : "—";
    refreshCounts();
  }

  /* ---------------- 铃铛弹层 ---------------- */
  var _bellOutside = null;
  var _bellKey = null;

  function closeBell() {
    var pop = document.getElementById("hrBell");
    if (pop) pop.remove();
    var btn = document.getElementById("bellBtn");
    if (btn) btn.setAttribute("aria-expanded", "false");
    if (_bellOutside) { document.removeEventListener("mousedown", _bellOutside, true); _bellOutside = null; }
    if (_bellKey) { document.removeEventListener("keydown", _bellKey); _bellKey = null; }
  }

  function openBell() {
    if (document.getElementById("hrBell")) return;
    var items = notifications();
    var btn = document.getElementById("bellBtn");
    var html = items.length
      ? items.map(function (it) {
          return '<button type="button" class="hbell-it" role="menuitem" data-nid="' + esc(it.id) + '" data-view="' + esc(it.view) + '" data-param="' + esc(it.param || "") + '">' +
            '<span class="hbi-ic ' + esc(it.tone || "") + '">' + icon(it.icon) + "</span>" +
            '<span class="hbi-main"><b>' + esc(it.title) + "</b><small>" + esc(it.desc) + "</small></span>" +
            '<span class="hbi-at">' + esc(atLabel(it.at)) + "</span></button>";
        }).join("")
      : '<div class="hbell-empty">' + icon("check", 22) + "<b>没有未读提醒</b><span>新公告、对标截止、JD 风险、人才跟进会自动出现在这里。</span></div>";

    var pop = document.createElement("div");
    pop.className = "hbell";
    pop.id = "hrBell";
    pop.setAttribute("role", "menu");
    pop.setAttribute("aria-label", "提醒中心");
    pop.innerHTML =
      '<div class="hbell-hd"><b>提醒</b><span>' + (items.length ? items.length + " 条未读" : "全部已读") + "</span>" +
      '<button type="button" class="hbell-x" aria-label="关闭">' + icon("close", 15) + "</button></div>" +
      '<div class="hbell-list">' + html + "</div>" +
      '<div class="hbell-ft"><button type="button" class="hbell-link" data-hr-go="watch">提醒规则与全部动态 →</button>' +
      '<button type="button" class="hbell-readall" data-hr-readall' + (items.length ? "" : " disabled") + ">全部已读</button></div>";
    document.body.appendChild(pop);

    if (btn) {
      btn.setAttribute("aria-expanded", "true");
      var r = btn.getBoundingClientRect();
      pop.style.top = Math.round(r.bottom + 8) + "px";
      pop.style.right = Math.max(12, Math.round(window.innerWidth - r.right)) + "px";
    }

    pop.addEventListener("click", function (e) {
      var close = e.target.closest(".hbell-x");
      if (close) { closeBell(); return; }
      var it = e.target.closest(".hbell-it");
      if (it) {
        markSeen(it.getAttribute("data-nid"));
        closeBell();
        jump(it.getAttribute("data-view"), it.getAttribute("data-param"));
        refreshBell();
        return;
      }
      var ra = e.target.closest("[data-hr-readall]");
      if (ra) {
        markAllSeen();
        closeBell();
        refreshBell();
        if (currentView() === "watch") render("watch");
        return;
      }
      var go = e.target.closest("[data-hr-go]");
      if (go) {
        closeBell();
        setViewSafe(go.getAttribute("data-hr-go"));
      }
    });

    _bellOutside = function (e) {
      if (!pop.contains(e.target) && !(btn && btn.contains(e.target))) closeBell();
    };
    _bellKey = function (e) { if (e.key === "Escape") closeBell(); };
    setTimeout(function () {
      document.addEventListener("mousedown", _bellOutside, true);
      document.addEventListener("keydown", _bellKey);
    }, 0);
  }

  function toggleBell() { if (document.getElementById("hrBell")) closeBell(); else openBell(); }

  /* ---------------- 视图跳转 ---------------- */
  function setViewSafe(v) {
    if (typeof window.setView === "function") window.setView(v);
  }
  function currentView() {
    var v = "";
    try { v = new URLSearchParams(location.search).get("view") || ""; } catch (e) { v = ""; }
    if (!v) {
      var page = q(".main .page:not([hidden])");
      if (page && page.id) v = page.id.replace(/^view-/, "");
    }
    return v || "lib";
  }
  /* 直接切换视图：绕过 app.js 的 VIEW_LABEL 校验，
     由 hr-core 自己控制 .main .page 的显示与导航高亮。
     这样 app.js 可以保持零改动，减少与其它工具并发写同一文件的冲突。 */
  function hardSwitch(v) {
    if (!v) return false;
    var page = document.getElementById("view-" + v);
    if (!page) return false;
    qa(".main .page").forEach(function (p) { p.hidden = p.id !== "view-" + v; });
    qa(".navi a[data-view]").forEach(function (a) {
      if (a.getAttribute("data-view") === v) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    var crumb = document.querySelector(".topbar .crumb b");
    if (crumb) crumb.textContent = VIEW_LB[v] || v;
    var sc = document.getElementById("statusCount");
    if (sc) sc.textContent = statusText(v);
    document.documentElement.setAttribute("data-view", v);
    try { history.replaceState(null, "", "?view=" + encodeURIComponent(v)); } catch (e) { /* file:// 忽略 */ }
    render(v);
    return true;
  }

  /* app.js 在 window.load 时会 syncStatusText() 重写状态栏，
     这里在它之后把 HR 视图的状态文本补回去（只改文案，不重渲染页面）。 */
  function resyncStatus() {
    var v = currentView();
    if (!HR.views[v]) return;
    var page = document.getElementById("view-" + v);
    if (!page || page.hidden) return;
    var sc = document.getElementById("statusCount");
    if (sc) sc.textContent = statusText(v);
    var crumb = document.querySelector(".topbar .crumb b");
    if (crumb) crumb.textContent = VIEW_LB[v] || v;
  }

  function jump(view, param) {
    if (!view) return;
    if (HR.views[view]) hardSwitch(view);
    else setViewSafe(view);
    setTimeout(function () {
      param = String(param || "");
      if (view === "lib" && param && typeof window.openDrawer === "function") {
        try { window.openDrawer(Number(param)); } catch (e) { /* ignore */ }
        return;
      }
      if (view === "collect" && param) {
        var safe = param.replace(/["\\]/g, "");
        var btn2 = document.querySelector('.citem[data-n="' + safe + '"]');
        if (btn2) btn2.click();
        return;
      }
      if (view === "jd" && window.HR.views && HR.views.focusJd) HR.views.focusJd(param);
      if (view === "talent" && window.HR.views && HR.views.focusTalent) HR.views.focusTalent(param);
    }, 40);
  }

  /* ---------------- 角色菜单 / 侧栏脚 ---------------- */
  var _menuOutside = null;
  function updateUserLabel() {
    var foot = q(".rail-foot");
    if (!foot) return;
    var nm = foot.querySelector(".user .nm");
    var rl = foot.querySelector(".user .rl");
    var av = foot.querySelector(".user .av");
    if (nm) nm.textContent = state.profile.name;
    if (rl) rl.textContent = roleObj().lb + " · " + state.profile.org;
    if (av) av.textContent = String(state.profile.name || "陈").slice(0, 1);
  }

  function closeRoleMenu() {
    var m = document.getElementById("hrRoleMenu");
    if (m) m.hidden = true;
    var user = document.getElementById("hrUser");
    if (user) user.setAttribute("aria-expanded", "false");
    if (_menuOutside) { document.removeEventListener("mousedown", _menuOutside, true); _menuOutside = null; }
  }

  function toggleRoleMenu() {
    var menu = ensureRoleMenu();
    if (!menu) return;
    if (!menu.hidden) { closeRoleMenu(); return; }
    menu.hidden = false;
    var user = document.getElementById("hrUser");
    if (user) user.setAttribute("aria-expanded", "true");
    menu.querySelectorAll("[data-role]").forEach(function (b) {
      b.setAttribute("aria-checked", b.getAttribute("data-role") === state.role ? "true" : "false");
    });
    _menuOutside = function (e) {
      if (!menu.contains(e.target) && !(user && user.contains(e.target))) closeRoleMenu();
    };
    setTimeout(function () { document.addEventListener("mousedown", _menuOutside, true); }, 0);
  }

  function ensureRoleMenu() {
    var foot = q(".rail-foot");
    if (!foot) return null;
    var menu = document.getElementById("hrRoleMenu");
    if (menu) return menu;
    menu = document.createElement("div");
    menu.className = "hrmenu";
    menu.id = "hrRoleMenu";
    menu.hidden = true;
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "切换角色");
    menu.innerHTML =
      '<div class="hrmenu-hd">当前身份</div>' +
      ROLES.map(function (r) {
        return '<button type="button" class="hrmenu-it" role="menuitemradio" aria-checked="false" data-role="' + r.k + '">' +
          "<b>" + esc(r.lb) + "<em>" + esc(r.tag) + "</em></b><small>" + esc(r.desc) + "</small></button>";
      }).join("") +
      '<div class="hrmenu-sep"></div>' +
      '<button type="button" class="hrmenu-it slim" role="menuitem" data-open="settings"><b>设置与合规</b><small>数据源 · 权限 · 集成 · 本地数据</small></button>';
    foot.appendChild(menu);
    menu.addEventListener("click", function (e) {
      var b = e.target.closest("[data-role]");
      if (b) { setRole(b.getAttribute("data-role")); return; }
      var o = e.target.closest("[data-open]");
      if (o) { closeRoleMenu(); setViewSafe(o.getAttribute("data-open")); }
    });
    return menu;
  }

  function setRole(k) {
    var r = ROLES.filter(function (x) { return x.k === k; })[0];
    if (!r) return;
    if (r.k === state.role) { closeRoleMenu(); return; }
    state.role = r.k;
    persist();
    audit("切换角色", r.lb, currentView());
    updateUserLabel();
    closeRoleMenu();
    toast("已切换为「" + r.lb + "」" + (r.write ? "" : " · 只读模式"));
    var v = currentView();
    if (HR.views[v]) hardSwitch(v);
    refreshBell();
  }

  function mountChrome() {
    var foot = q(".rail-foot");
    if (!foot) return;
    var user = foot.querySelector(".user");
    if (user && !user.id) user.id = "hrUser";
    if (user && !user.hasAttribute("role")) {
      user.setAttribute("role", "button");
      user.setAttribute("tabindex", "0");
      user.setAttribute("aria-haspopup", "menu");
      user.setAttribute("aria-expanded", "false");
      user.addEventListener("click", function (e) { e.preventDefault(); toggleRoleMenu(); });
      user.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowUp") { e.preventDefault(); toggleRoleMenu(); }
      });
    }
    var link = foot.querySelector(".hr-footlink");
    if (!link) {
      link = document.createElement("a");
      link.className = "hr-footlink";
      link.href = "#";
      link.setAttribute("data-view", "settings");
      link.innerHTML = icon("settings", 13) + "<span>设置 · 合规</span>";
      link.addEventListener("click", function (e) { e.preventDefault(); setViewSafe("settings"); });
      foot.appendChild(link);
    }
    updateUserLabel();
    ensureRoleMenu();
    refreshBell();
    bindBridge();
  }

  /* 全局捕获：新视图导航与铃铛由本层接管，app.js 不需要打补丁 */
  var _bridgeBound = false;
  function bindBridge() {
    if (_bridgeBound) return;
    _bridgeBound = true;
    document.addEventListener("click", function (e) {
      if (!e.target || !e.target.closest) return;
      var a = e.target.closest(".navi a[data-view]");
      if (a) {
        var v = a.getAttribute("data-view");
        if (HR.views[v]) {
          e.preventDefault();
          e.stopPropagation();
          hardSwitch(v);
        }
        return;
      }
      var bell = e.target.closest("#bellBtn");
      if (bell) {
        e.preventDefault();
        e.stopPropagation();
        toggleBell();
      }
    }, true);
    /* 任何点击之后补一次状态栏（视图内按钮直接 render，不会走 hardSwitch） */
    document.addEventListener("click", function () {
      setTimeout(function () {
        var v = currentView();
        if (HR.views[v]) resyncStatus();
      }, 0);
    });
    window.addEventListener("popstate", function () {
      var v = currentView();
      if (HR.views[v]) hardSwitch(v);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        var a = document.activeElement && document.activeElement.closest ? document.activeElement.closest(".navi a[data-view]") : null;
        if (a && HR.views[a.getAttribute("data-view")]) {
          e.preventDefault();
          hardSwitch(a.getAttribute("data-view"));
        }
      }
    });
  }

  /* ---------------- 弹层（新建/编辑/确认共用） ---------------- */
  function modal(opt) {
    opt = opt || {};
    closeModal();
    var wrap = document.createElement("div");
    wrap.className = "hrmodal";
    wrap.id = "hrModal";
    wrap.innerHTML =
      '<div class="hrmodal-scrim" data-close></div>' +
      '<div class="hrmodal-box' + (opt.wide ? " wide" : "") + '" role="dialog" aria-modal="true" aria-label="' + esc(opt.title || "编辑") + '">' +
        '<div class="hrmodal-hd"><div><b>' + esc(opt.title || "编辑") + "</b>" + (opt.sub ? "<small>" + esc(opt.sub) + "</small>" : "") + "</div>" +
        '<button type="button" class="icobtn" data-close aria-label="关闭">' + icon("close", 15) + "</button></div>" +
        '<div class="hrmodal-bd">' + (opt.body || "") + "</div>" +
        '<div class="hrmodal-ft"><span class="hrmodal-err" data-err></span>' +
        '<button type="button" class="btn ghost" data-close>' + esc(opt.cancelText || "取消") + "</button>" +
        '<button type="button" class="btn primary" data-ok>' + esc(opt.okText || "保存") + "</button></div>" +
      "</div>";
    document.body.appendChild(wrap);
    var done = function () {
      document.removeEventListener("keydown", onKey);
      wrap.remove();
      if (typeof opt.onClose === "function") opt.onClose();
    };
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); done(); }
      if ((e.key === "Enter" && (e.metaKey || e.ctrlKey)) && okBtn) { e.preventDefault(); okBtn.click(); }
    }
    wrap.querySelectorAll("[data-close]").forEach(function (el) { el.addEventListener("click", done); });
    var okBtn = wrap.querySelector("[data-ok]");
    if (okBtn) {
      okBtn.addEventListener("click", function () {
        var res = typeof opt.onOk === "function" ? opt.onOk(wrap) : true;
        if (res !== false) done();
      });
    }
    document.addEventListener("keydown", onKey);
    var first = wrap.querySelector("input, select, textarea, button.primary");
    if (first) setTimeout(function () { first.focus(); }, 30);
    return { el: wrap, close: done };
  }
  function closeModal() {
    var m = document.getElementById("hrModal");
    if (m) m.remove();
  }
  function confirmBox(title, message, onOk, okText) {
    return modal({
      title: title,
      body: '<p class="hrmodal-msg">' + esc(message) + "</p>",
      okText: okText || "确认",
      onOk: function () { if (typeof onOk === "function") onOk(); return true; }
    });
  }

  /* ---------------- 状态栏文案 / 视图注册 ---------------- */
  var views = {};
  function render(v) {
    var page = document.getElementById("view-" + v);
    if (!page) return false;
    var fn = views[v];
    if (typeof fn === "function") {
      try { fn(page); } catch (e) {
        console.error("[HR] render " + v + " failed", e);
        page.innerHTML = '<div class="empty"><b>视图渲染出错</b><span>' + esc(e && e.message ? e.message : String(e)) + "</span></div>";
        return true;
      }
    } else {
      page.innerHTML = '<div class="empty"><b>「' + esc(VIEW_LB[v] || v) + "」还没装配</b><span>这个视图由 hr-views-*.js 注册，先检查脚本是否加载。</span></div>";
    }
    return true;
  }
  function statusText(v) {
    if (v === "jd") {
      var live = state.jd.filter(function (j) { return j.status === "live"; }).length;
      var draft = state.jd.filter(function (j) { return j.status === "draft"; }).length;
      return "我的职位 " + state.jd.length + " 个 · 在招 " + live + " 个 · 草稿 " + draft + " 个";
    }
    if (v === "talent") {
      var pending = state.talent.filter(function (t) { return t.stage === "new"; }).length;
      var active = state.talent.filter(function (t) { return ["screen", "interview", "offer"].indexOf(t.stage) >= 0; }).length;
      return "候选人 " + state.talent.length + " 人 · 待初筛 " + pending + " 人 · 推进中 " + active + " 人";
    }
    if (v === "watch") {
      return "提醒 " + unread() + " 条未读 · 规则 " + state.rules.length + " 条 · 快照 " + (META().snapshot || isoDate(new Date()));
    }
    if (v === "brief") {
      return "一页纸简报 · 快照 " + (META().snapshot || isoDate(new Date())) + " · 数据现算，可随时重出";
    }
    if (v === "settings") {
      return "数据源 " + (NOTICES().length || 0) + " 个 · 岗位 " + fmt(DATA().length) + " 条 · 本地存储 · 权限与合规模块";
    }
    return "";
  }

  /* ---------------- 职位 / 人才 仓库 ---------------- */
  function jdList() { return state.jd; }
  function jdGet(id) {
    return state.jd.filter(function (j) { return j.id === id; })[0] || null;
  }
  function jdAdd(fields) {
    if (!requireWrite()) return null;
    fields = fields || {};
    var title = String(fields.title || "").trim();
    if (!title) { toast("职位名称不能为空"); return null; }
    var now = isoDate(new Date());
    var j = {
      id: uid("jd"),
      title: title,
      dept: String(fields.dept || "").trim(),
      level: String(fields.level || "").trim(),
      city: String(fields.city || state.profile.city || "").trim(),
      type: String(fields.type || "事业单位").trim(),
      edu: String(fields.edu || "不限").trim(),
      exp: String(fields.exp || "不限").trim(),
      major: String(fields.major || "").trim(),
      salaryMin: fields.salaryMin === "" || fields.salaryMin == null ? null : Number(fields.salaryMin),
      salaryMax: fields.salaryMax === "" || fields.salaryMax == null ? null : Number(fields.salaryMax),
      months: Number(fields.months) || 12,
      headcount: Number(fields.headcount) || 1,
      responsibilities: String(fields.responsibilities || "").trim(),
      requirements: String(fields.requirements || "").trim(),
      status: fields.status === "live" ? "live" : "draft",
      sourceJobId: fields.sourceJobId != null ? Number(fields.sourceJobId) : null,
      note: "",
      created: now,
      updated: now,
      versions: [{ at: now, by: state.profile.name, note: "创建职位" }]
    };
    state.jd.unshift(j);
    persist();
    audit("新建职位", j.title + "（" + (JD_STATUS[j.status] || JD_STATUS.draft).lb + "）", "jd");
    refreshBell();
    return j;
  }
  function jdUpdate(id, patch) {
    if (!requireWrite()) return null;
    var j = jdGet(id);
    if (!j) return null;
    var changed = [];
    Object.keys(patch || {}).forEach(function (k) {
      if (["id", "created", "versions"].indexOf(k) >= 0) return;
      var v = patch[k];
      if (k === "salaryMin" || k === "salaryMax") v = v === "" || v == null ? null : Number(v);
      if (k === "months" || k === "headcount") v = Number(v) || j[k];
      if (j[k] !== v) { j[k] = v; changed.push(k); }
    });
    if (!changed.length) return j;
    j.updated = isoDate(new Date());
    j.versions.push({ at: j.updated, by: state.profile.name, note: "更新 · " + changed.length + " 个字段" });
    if (j.versions.length > 12) j.versions = j.versions.slice(-12);
    persist();
    audit("更新职位", j.title + "（" + changed.join("、") + "）", "jd");
    refreshBell();
    return j;
  }
  function jdSetStatus(id, status) {
    if (!requireWrite()) return null;
    var j = jdGet(id);
    if (!j || !JD_STATUS[status]) return null;
    if (j.status === status) return j;
    j.status = status;
    j.updated = isoDate(new Date());
    j.versions.push({ at: j.updated, by: state.profile.name, note: "状态 → " + JD_STATUS[status].lb });
    persist();
    audit("职位状态", j.title + " → " + JD_STATUS[status].lb, "jd");
    refreshBell();
    return j;
  }
  function jdRemove(id) {
    if (!requireWrite()) return false;
    var j = jdGet(id);
    state.jd = state.jd.filter(function (x) { return x.id !== id; });
    persist();
    if (j) audit("删除职位", j.title, "jd");
    refreshBell();
    return true;
  }

  function talentList() { return state.talent; }
  function talentGet(id) {
    return state.talent.filter(function (t) { return t.id === id; })[0] || null;
  }
  function talentAdd(fields) {
    if (!requireWrite()) return null;
    fields = fields || {};
    var name = String(fields.name || "").trim();
    if (!name) { toast("候选人姓名不能为空"); return null; }
    var phone = String(fields.phone || "").trim();
    var jobId = fields.jobId || "";
    if (phone && state.talent.some(function (t) { return t.phone === phone && (t.jobId || "") === jobId; })) {
      toast("同岗位下这个手机号已存在");
      return null;
    }
    var now = isoDate(new Date());
    var jd = jobId ? jdGet(jobId) : null;
    var t = {
      id: uid("tal"),
      name: name,
      phone: phone,
      email: String(fields.email || "").trim(),
      source: String(fields.source || "手动录入").trim(),
      jobId: jobId || "",
      jobTitle: jd ? jd.title : String(fields.jobTitle || "").trim(),
      stage: TALENT_STAGES.some(function (s) { return s.k === fields.stage; }) ? fields.stage : "new",
      note: String(fields.note || "").trim(),
      created: now,
      updated: now
    };
    state.talent.unshift(t);
    persist();
    audit("新增候选人", t.name + (t.jobTitle ? " · " + t.jobTitle : ""), "talent");
    refreshBell();
    return t;
  }
  function talentUpdate(id, patch) {
    if (!canNote()) { toast("当前角色只能查看，不能改候选人"); return null; }
    var t = talentGet(id);
    if (!t) return null;
    var changed = [];
    Object.keys(patch || {}).forEach(function (k) {
      if (["id", "created"].indexOf(k) >= 0) return;
      if (k === "stage" && !TALENT_STAGES.some(function (s) { return s.k === patch[k]; })) return;
      if (t[k] !== patch[k]) { t[k] = patch[k]; changed.push(k); }
    });
    if (!changed.length) return t;
    t.updated = isoDate(new Date());
    if (changed.indexOf("stage") >= 0) {
      var s = TALENT_STAGES.filter(function (x) { return x.k === t.stage; })[0];
      audit("候选人推进", t.name + " → " + (s ? s.lb : t.stage), "talent");
    } else {
      audit("更新候选人", t.name + "（" + changed.join("、") + "）", "talent");
    }
    persist();
    refreshBell();
    return t;
  }
  function talentRemove(id) {
    if (!requireWrite()) return false;
    var t = talentGet(id);
    state.talent = state.talent.filter(function (x) { return x.id !== id; });
    persist();
    if (t) audit("删除候选人", t.name, "talent");
    refreshBell();
    return true;
  }
  function talentAddMany(list) {
    if (!requireWrite()) return { added: 0, skipped: 0 };
    var now = isoDate(new Date());
    var added = 0, skipped = 0;
    (list || []).forEach(function (f) {
      var name = String(f.name || "").trim();
      if (!name) { skipped++; return; }
      var phone = String(f.phone || "").trim();
      var jobId = f.jobId || "";
      if (phone && state.talent.some(function (t) { return t.phone === phone && (t.jobId || "") === jobId; })) { skipped++; return; }
      var jd = jobId ? jdGet(jobId) : null;
      state.talent.unshift({
        id: uid("tal"), name: name, phone: phone, email: String(f.email || "").trim(),
        source: String(f.source || "CSV 导入").trim(), jobId: jobId || "", jobTitle: jd ? jd.title : String(f.jobTitle || "").trim(),
        stage: TALENT_STAGES.some(function (s) { return s.k === f.stage; }) ? f.stage : "new",
        note: String(f.note || "").trim(), created: now, updated: now
      });
      added++;
    });
    persist();
    if (added) audit("批量导入候选人", "新增 " + added + " 人，跳过 " + skipped + " 人", "talent");
    refreshBell();
    return { added: added, skipped: skipped };
  }
  function talentCSV() {
    var head = ["姓名", "手机", "邮箱", "来源", "关联职位", "阶段", "备注", "更新时间"];
    var rows = state.talent.map(function (t) {
      var s = TALENT_STAGES.filter(function (x) { return x.k === t.stage; })[0];
      return [t.name, t.phone, t.email, t.source, t.jobTitle, s ? s.lb : t.stage, t.note, t.updated];
    });
    return [csvLine(head)].concat(rows.map(csvLine)).join("\r\n");
  }

  /* talent CSV 解析：容忍中英文表头、BOM、引号 */
  function parseCSV(text) {
    var s = String(text || "").replace(/^\uFEFF/, "");
    var rows = [], row = [], cell = "", quote = false;
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (quote) {
        if (c === '"') {
          if (s[i + 1] === '"') { cell += '"'; i++; }
          else quote = false;
        } else cell += c;
      } else if (c === '"') quote = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (c === "\r") { /* skip */ }
      else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ""; }); });
  }
  function talentImport(text) {
    if (!requireWrite()) return { added: 0, skipped: 0, error: "只读角色" };
    var rows = parseCSV(text);
    if (!rows.length) return { added: 0, skipped: 0, error: "文件是空的" };
    var head = rows[0].map(function (h) { return String(h).trim().toLowerCase(); });
    var idx = function (keys) {
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i].toLowerCase();
        var p = head.indexOf(k);
        if (p >= 0) return p;
      }
      return -1;
    };
    var iName = idx(["姓名", "name", "候选人", "名字"]);
    if (iName < 0) iName = 0;
    var iPhone = idx(["手机", "电话", "phone", "mobile", "手机号"]);
    var iMail = idx(["邮箱", "email", "e-mail"]);
    var iSrc = idx(["来源", "source", "渠道"]);
    var iJob = idx(["关联职位", "职位", "岗位", "job", "jobtitle"]);
    var iNote = idx(["备注", "note", "备注信息"]);
    var list = [];
    for (var r = 1; r < rows.length; r++) {
      var any = rows[r].some(function (x) { return String(x).trim() !== ""; });
      if (!any) continue;
      list.push({
        name: rows[r][iName],
        phone: iPhone >= 0 ? rows[r][iPhone] : "",
        email: iMail >= 0 ? rows[r][iMail] : "",
        source: iSrc >= 0 ? rows[r][iSrc] : "CSV 导入",
        jobTitle: iJob >= 0 ? rows[r][iJob] : "",
        note: iNote >= 0 ? rows[r][iNote] : ""
      });
    }
    return talentAddMany(list);
  }

  /* ---------------- 公开 API ---------------- */
  var HR = {
    version: "1.1.0",
    roles: ROLES,
    stages: TALENT_STAGES,
    jdStatus: JD_STATUS,
    stageLabel: STAGE_LB,
    viewLabel: VIEW_LB,
    esc: esc,
    fmt: fmt,
    icon: icon,
    q: q,
    qa: qa,
    uid: uid,
    toast: toast,
    isoDate: isoDate,
    isoMinute: isoMinute,
    daysFrom: daysFrom,
    atLabel: atLabel,
    copyText: copyText,
    download: download,
    csvLine: csvLine,
    state: function () { return state; },
    profile: function () { return state.profile; },
    role: roleObj,
    roleKey: function () { return state.role; },
    canWrite: canWrite,
    canNote: canNote,
    setRole: setRole,
    save: persist,
    audit: audit,
    positions: DATA,
    posById: posById,
    notices: NOTICES,
    noticeById: noticeById,
    meta: META,
    bench: bench,
    rules: { list: rules, rows: ruleRows, add: addRule, toggle: toggleRule, remove: removeRule },
    jd: { list: jdList, get: jdGet, add: jdAdd, update: jdUpdate, setStatus: jdSetStatus, remove: jdRemove },
    talent: { list: talentList, get: talentGet, add: talentAdd, update: talentUpdate, remove: talentRemove, addMany: talentAddMany, csv: talentCSV, importText: talentImport },
    notifications: notifications,
    unread: unread,
    markSeen: markSeen,
    markAllSeen: markAllSeen,
    refreshBell: refreshBell,
    refreshCounts: refreshCounts,
    toggleBell: toggleBell,
    closeBell: closeBell,
    openBell: openBell,
    jump: jump,
    switchTo: hardSwitch,
    resync: resyncStatus,
    setView: setViewSafe,
    currentView: currentView,
    modal: modal,
    closeModal: closeModal,
    confirm: confirmBox,
    statusText: statusText,
    views: views,
    render: render,
    mountChrome: mountChrome
  };
  window.HR = HR;
  HR.market = {};   /* 由 hr-market.js 填充 */
  HR.views.focusJd = null;
  HR.views.focusTalent = null;

  /* ---------------- 初始化 ---------------- */
  function boot() {
    if (!state.booted) {
      /* 首次进入：旧公告（7 天前）默认已读，近 7 天的公告留成未读 */
      NOTICES().forEach(function (n) {
        var age = daysFrom(n.published);
        if (age != null && age > 7) markSeen("notice:" + n.id);
      });
      if (state.seen.jobs == null) state.seen.jobs = DATA().length;
      state.booted = true;
      state.lastVisit = isoDate(new Date());
      persist();
    }
    mountChrome();
    /* 如果打开时深链到新视图，视图脚本已就绪，补渲染一次 */
    var v = currentView();
    if (HR.views[v]) hardSwitch(v);
    refreshBell();
    /* app.js 的 window.load 回调会 syncStatusText() 覆盖状态栏，这里补回 HR 视图的文案 */
    window.addEventListener("load", function () {
      setTimeout(resyncStatus, 0);
      setTimeout(resyncStatus, 160);
      setTimeout(resyncStatus, 600);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
