/* =====================================================================
   数据层（解码器）：把 data-smith 生成的紧凑数据还原成页面用的对象
   ---------------------------------------------------------------------
   输入（scripts/build_jobs.py 产出，script 标签顺序在前）：
     window.STARTA_JOBS    = { meta, str[], rows[16 列下标] }
     window.STARTA_NOTICES = [ 真实公告 ×2，含附件 / 时间线 / 报名期 ]
     window.STARTA_COLLECT = { at, stats, items[] } 采集链路留痕
   输出：window.STARTA（app.js / me.js 只认这个门面）

   rows 列序：0 src 1 city 2 u 3 post 4 code 5 e 6 emin 7 deg 8 m 9 n
             10 dept 11 resp 12 lv 13 cand 14 add 15 mf
   - 除 6（学历序号 0–5 整数）与 9（拟聘人数，整数）外，其余都是 str 表下标。
   - 岗位列 9,167 行为空（广东岗位表只给部门+等级），详情页用「部门 · 等级」
     兜底成可读岗位名，并保留 code 供检索。
   ===================================================================== */
window.STARTA = (function(){
  const JOBS    = window.STARTA_JOBS    || { meta:{}, str:[], rows:[] };
  const NOTICES = window.STARTA_NOTICES || [];
  const COLLECT = window.STARTA_COLLECT || { items:[] };
  const STR     = JOBS.str || [];
  const RAW     = JOBS.rows || [];
  const META_J  = JOBS.meta || {};

  const EDU_ORDER = ["不限", "高中以上", "专科以上", "本科以上", "硕士以上", "博士"];
  const TYPES     = ["事业单位", "国企"];

  function today(){
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }
  function pad2(n){ return String(n).padStart(2, "0"); }

  /* 公告报名截止日（ISO）→ 岗位的 d / end / open / left */
  const NOTICE_BY_ID = {};
  NOTICES.forEach(function(n){
    NOTICE_BY_ID[n.id] = n;
    n.end = n.endDate || n.applyEnd || "";
    n.start = n.startDate || n.applyStart || "";
  });

  /* 截止、报名窗口等一律按「绝对日期」算，不再做最近年份猜测 */
  function daysFromISO(iso){
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Math.round((d - today()) / 86400000);
  }
  function daysLeft(str){
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.test(String(str || ""));
    if (iso) return daysFromISO(str);
    const m = /(\d{1,2})-(\d{1,2})/.exec(String(str || ""));
    if (!m) return null;
    const base = today(), y = base.getFullYear();
    let d = new Date(y, Number(m[1]) - 1, Number(m[2]));
    const gap = Math.round((d - base) / 86400000);
    if (gap > 183) d = new Date(y - 1, Number(m[1]) - 1, Number(m[2]));
    else if (gap < -183) d = new Date(y + 1, Number(m[1]) - 1, Number(m[2]));
    return Math.round((d - today()) / 86400000);
  }
  function mmdd(iso){
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    return m ? m[2] + "-" + m[3] : "";
  }

  const CHANNEL = {
    gd2026:   "广东省事业单位公开招聘信息管理系统 · 网上报名",
    dxal2026: "全国事业单位招聘网 · 网上报名（qgsydw.com）"
  };
  const DXAL_DESC = "公告岗位表未给出职责描述，工作内容与考试方式见附件《岗位计划表》PDF。";

  /* ---------------- 解码 9,200 行 ---------------- */
  const DATA = new Array(RAW.length);
  const UMAP = Object.create(null);
  const MAJOR_TOK = Object.create(null);
  const EDU_SET = Object.create(null);

  for (let i = 0; i < RAW.length; i++) {
    const r = RAW[i];
    const g = function(k){ const v = r[k]; return v == null ? "" : (STR[v] || ""); };
    const src   = g(0);
    const city  = g(1);
    const unit  = g(2);
    const post  = g(3);
    const code  = g(4);
    const edu   = g(5);
    const deg   = g(7);
    const major = g(8);
    const seats = Number(r[9]) || 0;
    const dept  = g(10);
    const resp  = g(11);
    const level = g(12);
    const cand  = g(13);
    const added = g(14);
    const mf    = g(15);
    const notice = NOTICE_BY_ID[src] || {};
    const end    = notice.end || "";
    const left   = end ? daysFromISO(end) : null;

    /* 岗位名兜底：岗位表没写岗位时用「部门 · 等级短名」，再不行用代码 */
    /* 岗位名兜底：岗位表没写岗位时用部门名；部门也没有才退到等级或代码。
       等级、代码在抽屉里单独展示，不塞进列表，避免把表格撑爆。 */
    let role = post || dept;
    if (!role) {
      const shortLv = level.replace(/^专业技术岗位/, "专技").replace(/^管理岗位/, "管理");
      role = shortLv || ("岗位 " + code);
    }

    const d = {
      i: i,
      src: src,
      t: src === "gd2026" ? "事业单位" : "国企",
      u: unit,
      r: role,
      post: post,
      code: code,
      e: edu || "不限",
      deg: deg || "不限",
      m: major,
      mf: mf,
      n: seats,
      city: city,
      x: cand || "不限",
      cand: cand || "不限",
      dept: dept,
      lv: level,
      desc: resp || (src === "dxal2026" ? DXAL_DESC : ""),
      w: CHANNEL[src] || "",
      d: mmdd(end),
      end: end,
      start: notice.start || "",
      open: left !== null && left >= 0,
      left: left,
      added: added,
      noticeId: src
    };
    DATA[i] = d;

    /* 单位聚合（4,519 家） */
    let u = UMAP[unit];
    if (!u) { u = UMAP[unit] = { u: unit, t: d.t, city: city, n: 0, seats: 0, roles: [], src: src, _seen: Object.create(null) }; }
    u.n += 1;                 /* 岗位条数 */
    u.seats += seats;         /* 拟聘人数合计 */
    if (u.roles.length < 6 && !u._seen[role]) { u._seen[role] = 1; u.roles.push(role); }

    /* 筛选项 */
    if (edu) EDU_SET[edu] = (EDU_SET[edu] || 0) + 1;
    if (mf) mf.split("/").forEach(function(k){ if (k) MAJOR_TOK[k] = (MAJOR_TOK[k] || 0) + 1; });
  }

  /* ---------------- 派生口径 ---------------- */
  function kpis(){
    let open = 0, urgent7 = 0, units = 0, seats = 0;
    for (let i = 0; i < DATA.length; i++) {
      const d = DATA[i];
      seats += d.n;
      if (d.open) { open++; if (d.left <= 7) urgent7++; }
    }
    units = Object.keys(UMAP).length;
    return {
      total: DATA.length, sample: DATA.length, open: open, urgent7: urgent7,
      weekNew: NOTICES.length, units: units, seats: seats, types: TYPES.length,
      notices: NOTICES.length
    };
  }

  function unitsOf(){
    return Object.keys(UMAP).map(function(k){ return UMAP[k]; });
  }
  function majors(){
    return Object.keys(MAJOR_TOK).sort(function(a, b){ return MAJOR_TOK[b] - MAJOR_TOK[a] || (a < b ? -1 : a > b ? 1 : 0); });
  }
  function edus(){
    return EDU_ORDER.filter(function(e){ return EDU_SET[e]; });
  }
  /* 兼容旧接口：门槛剖面已改多组分布，这里保留最小实现 */
  function skillStats(list){
    const src = list && list.length ? list : DATA;
    const tally = function(k){ const m = Object.create(null); src.forEach(function(d){ const v = d[k] || "不限"; m[v] = (m[v] || 0) + 1; }); return Object.keys(m).map(function(k2){ return { k: k2, v: m[k2] }; }).sort(function(a, b){ return b.v - a.v; }); };
    return {
      total: src.length,
      edu: tally("e"), type: tally("t"), majorClass: tally("mf"), cand: tally("cand")
    };
  }

  const META = {
    snapshot: META_J.snapshot || "2026-10-20",
    builtAt: META_J.builtAt || "",
    totalJobs: META_J.rows || DATA.length,
    sample: DATA.length,
    units: META_J.units || Object.keys(UMAP).length,
    seats: META_J.seats || 0,
    regions: META_J.regions || 0,
    tables: META_J.tables || {},
    sources: META_J.sources || []
  };

  const collectedAt = (META_J.builtAt || COLLECT.at || "").slice(0, 10);

  return {
    DATA: DATA,
    NOTICES: NOTICES,
    NOTICE_ROLES: {},
    COLLECT: COLLECT,
    TYPES: TYPES,
    EDU_ORDER: EDU_ORDER,
    EDU_COUNTS: EDU_SET,
    MAJOR_TOKENS: MAJOR_TOK,
    META: META,
    collectedAt: collectedAt,
    today: today,
    daysLeft: daysLeft,
    daysFromISO: daysFromISO,
    mmdd: mmdd,
    kpis: kpis,
    unitsOf: unitsOf,
    majors: majors,
    edus: edus,
    skillStats: skillStats,
    noticeOf: function(d){ return NOTICE_BY_ID[(d && (d.src || d.noticeId)) || ""] || null; }
  };
})();
