/* ======================================================================
   星他（STARTA）招聘工作台 · assets/app.js
   渲染与交互层：岗位库 / 公告采集 / 单位库 / 我的投递 / 技能剖面。
   数据全部来自 window.STARTA（assets/data.js）；字段缺失一律本地兜底。
   ====================================================================== */

/* ---------------- 数据层兼容层 ---------------- */
const S = window.STARTA || {};
const DATA = Array.isArray(S.DATA) ? S.DATA : [];
const NOTICES = Array.isArray(S.NOTICES) ? S.NOTICES : [];
const NOTICE_ROLES = S.NOTICE_ROLES && typeof S.NOTICE_ROLES === "object" ? S.NOTICE_ROLES : {};
const FALLBACK_TYPES = ["央企", "国企", "事业单位", "公务员", "民营", "外企"];
let TYPES = Array.isArray(S.TYPES) ? S.TYPES.filter(t => typeof t === "string" && t !== "全部") : [];
if (!TYPES.length) TYPES = FALLBACK_TYPES.slice();

/* ---------------- 小工具 ---------------- */
const $ = s => document.querySelector(s);
const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
const on = (sel, ev, fn, opt) => {
  const el = typeof sel === "string" ? $(sel) : sel;
  if (el) el.addEventListener(ev, fn, opt);
  return el;
};
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad2 = n => (n < 10 ? "0" : "") + n;
const setText = (sel, v) => { const el = typeof sel === "string" ? $(sel) : sel; if (el) el.textContent = v; return el; };
const uniq = arr => Array.from(new Set(arr.filter(Boolean)));

const LS = {
  theme: "strata-wb-theme",
  density: "strata-wb-density",
  fs: "strata-wb-fs",
  saved: "strata-wb-saved",
  filters: "strata-wb-filters"
};
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 隐私模式忽略 */ } }

/* ---------------- 日期（一律来自 data.js 的真实当天，不写死快照日） ---------------- */
function todayDate() {
  if (typeof S.today === "function") {
    try {
      const t = S.today();
      if (t instanceof Date && !isNaN(t.getTime())) return new Date(t.getFullYear(), t.getMonth(), t.getDate());
    } catch (e) { /* 兜底 */ }
  }
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}
const TODAY_DATE = todayDate();
const TODAY = pad2(TODAY_DATE.getMonth() + 1) + "-" + pad2(TODAY_DATE.getDate());

function daysLeft(dstr) {
  if (typeof S.daysLeft === "function") {
    try { const v = S.daysLeft(dstr); if (typeof v === "number" && isFinite(v)) return v; } catch (e) { /* 走本地兜底 */ }
  }
  const m = /(\d{1,2})-(\d{1,2})/.exec(String(dstr || ""));
  if (!m) return null;
  // 用最近年份解析：跨年时自动落到去年 / 明年
  let t = new Date(TODAY_DATE.getFullYear(), +m[1] - 1, +m[2]);
  let diff = Math.round((t - TODAY_DATE) / 86400000);
  if (diff < -180) { t = new Date(TODAY_DATE.getFullYear() + 1, +m[1] - 1, +m[2]); diff = Math.round((t - TODAY_DATE) / 86400000); }
  else if (diff > 180) { t = new Date(TODAY_DATE.getFullYear() - 1, +m[1] - 1, +m[2]); diff = Math.round((t - TODAY_DATE) / 86400000); }
  return diff;
}
function addDaysDate(days) {
  const t = new Date(TODAY_DATE.getTime() + days * 86400000);
  return pad2(t.getMonth() + 1) + "-" + pad2(t.getDate());
}
function dueRank(s) {
  const m = /(\d{1,2})-(\d{1,2})/.exec(String(s || ""));
  if (!m) return 9999;
  return Number(m[1]) * 100 + Number(m[2]);
}
/* 排序键走 daysLeft：它已经处理跨年，长期开放（null）恒排最后，不随升/降序翻转 */
function dueCompare(a, b) {
  const la = daysLeft(a.d), lb = daysLeft(b.d);
  if (la === null || lb === null) {
    if (la === null && lb === null) return 0;
    return la === null ? 1 : -1;
  }
  return la - lb;
}
function isSoon(dstr) {
  const left = daysLeft(dstr);
  return left !== null && left >= 0 && left <= 7;
}

/* ---------------- 全局状态 ---------------- */
const state = {
  type: "全部",
  major: "全部专业",
  edu: "全部学历",
  q: "",
  sort: "due",
  dir: 1,
  sel: new Set(),
  saved: new Set(),
  exp: new Set(),
  uType: "全部",
  skillType: "全部",
  view: "lib",
  quick: null, /* null | "urgent" | "saved"：点 KPI 卡进来的快捷筛选 */
  prog: {}, /* i -> { st, at }：投递阶段 + 最后一次改动日期 */
  mineSt: null /* 我的投递页的阶段筛选 */
};

/* ---------------- 投递阶段 ----------------
   收藏 ≠ 投递。进了清单的岗位都带一个阶段，和「最后一次动它」的日期。 */
const STAGES = [
  { k: "saved",     lb: "待投", hint: "收进来了，还没投",   color: "muted" },
  { k: "applied",   lb: "已投", hint: "报名已交，等回音",   color: "#2C5D9E" },
  { k: "written",   lb: "笔试", hint: "笔试 / 测评阶段",    color: "#6B4FA8" },
  { k: "interview", lb: "面试", hint: "面谈环节",           color: "warn" },
  { k: "result",    lb: "结果", hint: "等结果 / 已出",       color: "ok" }
];
const STAGE_I = {};
STAGES.forEach((s, n) => { STAGE_I[s.k] = Object.assign({ n }, s); });
function stageOf(i) { return STAGE_I[(state.prog[i] || {}).st] || STAGE_I.saved; }
function stageChip(i) {
  const st = stageOf(i);
  return `<span class="st" data-st="${st.k}" title="${esc(st.hint)} · ${esc((state.prog[i] || {}).at || "")}"><i></i>${esc(st.lb)}</span>`;
}

/* ---------------- 持久化 ---------------- */
function persistSaved() {
  lsSet(LS.saved, JSON.stringify({
    list: Array.from(state.saved).sort((a, b) => a - b),
    prog: state.prog
  }));
}
function persistFilters() {
  lsSet(LS.filters, JSON.stringify({
    type: state.type, major: state.major, edu: state.edu, q: state.q,
    sort: state.sort, dir: state.dir, quick: state.quick
  }));
}
function restoreSaved() {
  try {
    const raw = JSON.parse(lsGet(LS.saved, "[]") || "[]");
    /* 兼容两种存储：旧格式 [3,7] / 新格式 { list:[3,7], prog:{3:{st,at}} } */
    const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.list) ? raw.list : []);
    const prog = (raw && !Array.isArray(raw) && raw.prog) || {};
    list.forEach(v => {
      const i = Number(v);
      if (!Number.isFinite(i) || !DATA[i]) return;
      state.saved.add(i);
      const p = prog[i];
      state.prog[i] = (p && STAGE_I[p.st])
        ? { st: p.st, at: typeof p.at === "string" && p.at ? p.at : TODAY }
        : { st: "saved", at: TODAY };
    });
  } catch (e) { /* 坏数据直接忽略 */ }
}
function restoreFilters() {
  try {
    const f = JSON.parse(lsGet(LS.filters, "null") || "null");
    if (f && typeof f === "object") {
      if (typeof f.type === "string" && (f.type === "全部" || TYPES.indexOf(f.type) >= 0)) state.type = f.type;
      if (typeof f.major === "string") state.major = f.major;
      if (typeof f.edu === "string") state.edu = f.edu;
      if (typeof f.q === "string") state.q = f.q;
      if (typeof f.sort === "string" && ["due", "n", "unit", "role", "type"].indexOf(f.sort) >= 0) state.sort = f.sort;
      if (f.dir === 1 || f.dir === -1) state.dir = f.dir;
      if (f.quick === null || f.quick === "urgent" || f.quick === "saved") state.quick = f.quick;
    }
  } catch (e) { /* 坏数据直接忽略 */ }
}

/* ---------------- 索引与筛选选项 ---------------- */
let byId = new Map();

/* data.js 的 majors()/edus() 首项就是「全部…」哨兵，这里统一去掉，由 mountFilters 补 */
function majorOptions() {
  let list = [];
  if (typeof S.majors === "function") {
    try {
      const a = S.majors();
      if (Array.isArray(a)) list = a.map(x => typeof x === "string" ? x : (x && (x.mf || x.m || x.label || x.name)) || "").filter(Boolean);
    } catch (e) { /* 兜底 */ }
  }
  if (!list.length) list = DATA.map(d => d && d.mf);
  return uniq(list.filter(x => x && x !== "全部专业"));
}
function eduOptions() {
  let list = [];
  if (typeof S.edus === "function") {
    try {
      const a = S.edus();
      if (Array.isArray(a)) list = a.map(x => typeof x === "string" ? x : (x && (x.e || x.label || x.name)) || "").filter(Boolean);
    } catch (e) { /* 兜底 */ }
  }
  if (!list.length) list = DATA.map(d => d && d.e);
  return uniq(list.filter(x => x && x !== "全部学历"));
}
function mountFilters() {
  const majors = ["全部专业"].concat(majorOptions());
  const edus = ["全部学历"].concat(eduOptions());
  if (majors.indexOf(state.major) < 0) state.major = "全部专业";
  if (edus.indexOf(state.edu) < 0) state.edu = "全部学历";
  const mEl = $("#major"), eEl = $("#edu");
  if (mEl) { mEl.innerHTML = majors.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join(""); mEl.value = state.major; }
  if (eEl) { eEl.innerHTML = edus.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join(""); eEl.value = state.edu; }
}
function mountTypebar() {
  const box = $("#typebar");
  if (!box) return;
  box.innerHTML = ["全部"].concat(TYPES).map(t =>
    `<button class="chip" data-type="${esc(t)}" aria-pressed="${String(state.type === t)}">${esc(t)}<span class="ct">0</span></button>`
  ).join("");
}
function reindex() {
  byId = new Map(DATA.map((d, i) => [i, d]));
  mountFilters();
}

/* ---------------- KPI 口径 ---------------- */
/* 库容 = 公告声明的 totalJobs + 采集新增条数（DATA.length 超过样本 sample 的部分），
   保证采集后分子/分母口径一致（初始 24/147 → 采集 3 条后 27/150） */
function libTotal() {
  const meta = S.META || {};
  const declared = Number(meta.totalJobs) || 0;
  const sample = Number(meta.sample) || 0;
  return Math.max(declared, DATA.length) + Math.max(0, DATA.length - sample);
}
/* data.js 没到位时的兜底口径：与 data.js 的 kpis() 保持同一套算法 */
function fallbackKpis() {
  const units = new Set();
  let urgent7 = 0;
  let weekNew = 0;
  DATA.forEach(d => {
    if (!d) return;
    if (d.u) units.add(d.u);
    const left = daysLeft(d.d);
    if (left !== null && left >= 0 && left <= 7) urgent7++;
    const age = daysLeft(d.added);
    if (age !== null && age >= -7 && age <= 0) weekNew++;
  });
  return {
    open: DATA.length,
    /* 库容 = 公告声明的 147 + 采集新增条数（DATA.length 超过样本 24 的部分），
       避免出现分子 27 > 分母 26 的尴尬，也让采集后「27 / 150」口径正确 */
    total: libTotal(),
    units: units.size,
    urgent7,
    weekNew
  };
}
function KPIS() {
  const base = fallbackKpis();
  if (typeof S.kpis === "function") {
    try {
      const k = S.kpis();
      if (k && typeof k === "object") {
        const out = Object.assign({}, base);
        ["open", "total", "units", "urgent7", "weekNew"].forEach(key => {
          const v = Number(k[key]);
          if (isFinite(v)) out[key] = v;
        });
        out.total = libTotal();
        return out;
      }
    } catch (e) { /* 兜底 */ }
  }
  return base;
}

/* ---------------- 筛选 / 排序 ---------------- */
function filtered() {
  const q = state.q.toLowerCase();
  const list = [];
  DATA.forEach((d, i) => {
    if (!d) return;
    if (state.type !== "全部" && d.t !== state.type) return;
    if (state.quick === "urgent" && !isSoon(d.d)) return;
    if (state.quick === "saved" && !state.saved.has(i)) return;
    if (state.major !== "全部专业" && d.mf !== state.major) return;
    if (state.edu !== "全部学历" && d.e !== state.edu) return;
    if (q) {
      const hay = `${d.u || ""} ${d.r || ""} ${d.m || ""} ${d.t || ""} ${d.city || ""} ${d.w || ""}`.toLowerCase();
      if (hay.indexOf(q) < 0) return;
    }
    list.push(Object.assign({}, d, { i }));
  });
  const key = state.sort;
  const dir = state.dir < 0 ? -1 : 1;
  list.sort((a, b) => {
    if (key === "n") return ((Number(a.n) || 0) - (Number(b.n) || 0)) * dir;
    if (key === "unit") {
      const u = String(a.u || "").localeCompare(String(b.u || ""), "zh");
      return u ? u * dir : dueCompare(a, b);
    }
    const dv = dueCompare(a, b);
    return dv ? dv * dir : (Number(b.n) || 0) - (Number(a.n) || 0);
  });
  return list;
}

/* 勾选与筛选一致：不可见的选中项立即移出 */
function pruneSel(list) {
  const visible = new Set((list || filtered()).map(d => d.i));
  let dropped = 0;
  state.sel.forEach(i => { if (!visible.has(i)) { state.sel.delete(i); dropped++; } });
  return dropped;
}
function visibleSelected() {
  return filtered().filter(d => state.sel.has(d.i));
}
function setSort(key, dir) {
  if (state.sort === key) state.dir = dir != null ? dir : -state.dir;
  else { state.sort = key; state.dir = dir != null ? dir : 1; }
  if (state.dir !== 1 && state.dir !== -1) state.dir = 1;
  const sel = $("#sort");
  if (sel && sel.value !== key) sel.value = key;
  persistFilters();
  render();
}

/* ---------------- 表格渲染 ---------------- */
/* 截止列：日期后面跟相对天数，省掉「还有几天」的心算；过期项弱化但不隐藏 */
function dueCell(d) {
  const left = daysLeft(d.d);
  if (left === null) return `<td class="c-due" title="长期开放">${esc(d.d)}<small>长期</small></td>`;
  if (left < 0) return `<td class="c-due expired" title="已过截止日">${esc(d.d)}<small>已过</small></td>`;
  const soon = left <= 7;
  const label = left === 0 ? "今天" : left + " 天";
  const tip = left === 0 ? "今天截止，别拖" : left <= 7 ? `距截止 ${left} 天，先处理` : `距截止 ${left} 天`;
  return `<td class="c-due${soon ? " soon" : ""}" title="${tip}">${esc(d.d)}<small>${label}</small></td>`;
}
function rowHtml(d) {
  const open = state.exp.has(d.i);
  const saved = state.saved.has(d.i);
  const main = `<tr data-i="${d.i}" tabindex="-1" class="${state.sel.has(d.i) ? "selected" : ""}${open ? " opened" : ""}">
    <td><input type="checkbox" ${state.sel.has(d.i) ? "checked" : ""} aria-label="选择 ${esc(d.u)} ${esc(d.r)}"></td>
    <td class="c-unit" title="${esc(d.u)}${d.city ? " · " + esc(d.city) : ""}"><span class="u-name">${esc(d.u)}</span><small class="u-meta"><span>${esc(d.city || "—")}</span>${state.saved.has(d.i) ? stageChip(d.i) : ""}</small></td>
    <td class="c-role">${esc(d.r)}</td>
    <td><span class="tag" data-t="${esc(d.t)}">${esc(d.t)}</span></td>
    <td class="c-major">${esc(d.m)}</td>
    <td class="c-dim c-edu">${esc(d.e)} · ${esc(d.x)}</td>
    <td class="c-num">${d.n} 人</td>
    ${dueCell(d)}
    <td class="c-op"><button class="go star" data-save="${d.i}" data-name="${esc(d.r)}" aria-pressed="${saved}" aria-label="${saved ? "取消收藏" : "收藏"} ${esc(d.r)}">${saved ? "★" : "☆"}</button><button class="expbtn" data-exp="${d.i}" aria-expanded="${open}" aria-label="展开 ${esc(d.r)} 的要求" title="展开要求"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button><button class="go" data-open="${d.i}">详情</button></td>
  </tr>`;
  return open ? main + expandRow(d) : main;
}
function expandRow(d) {
  const left = daysLeft(d.d);
  const win = left === null ? "长期开放，随到随投" : left < 0 ? "已截止" : left === 0 ? "今天截止" : `剩 ${left} 天`;
  return `<tr class="exp"><td colspan="9"><div class="exp-in">
    <div>
      <div class="exp-desc">${esc(d.desc)}</div>
      <div class="exp-actions">
        <button class="btn ghost" data-save="${d.i}">${state.saved.has(d.i) ? "★ 已收藏" : "☆ 收藏"}</button>
        <button class="btn ghost" data-copy="${d.i}">复制报名入口</button>
        <button class="btn ghost" data-open="${d.i}">看完整详情</button>
      </div>
      <div class="stchips" role="group" aria-label="设置 ${esc(d.r)} 的投递进度">
        ${STAGES.map(s => `<button class="stchip" data-stage="${d.i}" data-st="${s.k}" aria-pressed="${stageOf(d.i).k === s.k}" title="${esc(s.hint)}">${esc(s.lb)}</button>`).join("")}
        <span class="st-at">${state.saved.has(d.i) ? "上次更新 " + esc((state.prog[d.i] || {}).at || "—") : "选一个阶段即加入投递清单"}</span>
      </div>
    </div>
    <div class="exp-side">
      <div><div class="k">报名入口</div><b>${esc(d.w)}</b></div>
      <div><div class="k">报名窗口</div><b>${win}</b><span style="color:var(--muted);font-size:.78rem"> · 截止 ${esc(d.d)}</span></div>
      <div><div class="k">门槛</div>${esc(d.e)} · ${esc(d.x)} · 招 ${d.n} 人</div>
    </div>
  </div></td></tr>`;
}
function emptyJobsHtml() {
  if (state.quick === "saved") return `<b>还没有收藏的岗位</b>在列表里点一下 ☆ 收几个进来；或者点「在招岗位」卡回到全量。`;
  if (state.quick === "urgent") return `<b>眼下没有 7 天内截止的岗位</b>点「在招岗位」卡回到全量，或者按截止日期慢慢挑。`;
  return `<b>没有匹配的岗位</b>换个单位性质、专业或学历，或清空关键词、点「重置」再试。`;
}
function paintRows(list) {
  const rows = $("#rows");
  if (!rows) return;
  rows.innerHTML = list.length
    ? list.map(rowHtml).join("")
    : `<tr><td colspan="9"><div class="empty">${emptyJobsHtml()}</div></td></tr>`;
}
function syncSortUI() {
  $$("th.sortable").forEach(th => {
    const k = th.dataset.sort;
    const active = state.sort === k;
    const srt = th.querySelector(".srt");
    if (srt) srt.textContent = active ? (state.dir > 0 ? "↑" : "↓") : "";
    th.setAttribute("aria-sort", active ? (state.dir > 0 ? "ascending" : "descending") : "none");
  });
  const sel = $("#sort");
  if (sel && sel.value !== state.sort && $$("#sort option").some(o => o.value === state.sort)) sel.value = state.sort;
}
function syncTypebarCounts() {
  const counts = new Map();
  DATA.forEach(d => { if (d && d.t) counts.set(d.t, (counts.get(d.t) || 0) + 1); });
  $$("#typebar .chip").forEach(c => {
    const ct = c.querySelector(".ct");
    if (!ct) return;
    const t = c.dataset.type;
    ct.textContent = t === "全部" ? DATA.length : (counts.get(t) || 0);
    c.setAttribute("aria-pressed", String(state.type === t));
  });
}
function syncFiltersUI() {
  const m = $("#major"); if (m && m.value !== state.major) m.value = state.major;
  const e = $("#edu"); if (e && e.value !== state.edu) e.value = state.edu;
}
function syncBulk(list) {
  const vis = list || filtered();
  const ids = vis.map(d => d.i);
  const nSel = ids.filter(i => state.sel.has(i)).length;
  const bar = $("#bulkbar");
  if (bar) bar.classList.toggle("on", nSel > 0);
  setText("#bulkNum", nSel);
  const all = $("#checkAll");
  if (all) {
    all.checked = ids.length > 0 && nSel === ids.length;
    all.indeterminate = nSel > 0 && nSel < ids.length;
  }
  $$("#rows tr[data-i]").forEach(tr => {
    const i = Number(tr.dataset.i);
    tr.classList.toggle("selected", state.sel.has(i));
    const cb = tr.querySelector("input[type=checkbox]");
    if (cb) cb.checked = state.sel.has(i);
  });
}
function syncCountText(list) {
  const total = KPIS().total;
  setText("#count", `${list.length} / ${total}`);
  /* 状态栏是「当前视图」的口径：岗位库才写「显示 N / M 条」，
     其余视图由 syncStatusText() 负责，免得 render() 一跑就把别的视图文案冲掉 */
  if (state.view === "lib") setText("#statusCount", `显示 ${list.length} / ${total} 条`);
}
/* 我的投递：跟进 N 条 · 已投出 M 条 */
function mineStatus() {
  let act = 0;
  state.saved.forEach(i => { if (stageOf(i).k !== "saved") act++; });
  return state.saved.size ? `跟进 ${state.saved.size} 条 · 已投出 ${act} 条` : "跟进 0 条";
}
/* 按当前视图刷新状态栏（视图切换、阶段推进、漏斗筛选后都调它） */
function syncStatusText() {
  const v = state.view;
  if (v === "lib") { const list = filtered(); setText("#statusCount", `显示 ${list.length} / ${KPIS().total} 条`); }
  else if (v === "collect") setText("#statusCount", `采集 ${NOTICES.length} 条公告`);
  else if (v === "units") setText("#statusCount", `聚合 ${typeof S.unitsOf === "function" ? (S.unitsOf() || []).length : new Set(DATA.map(d => d.u)).size} 家单位`);
  else if (v === "mine") setText("#statusCount", mineStatus());
  else if (v === "skill") {
    const sr = skillRows(state.skillType === "全部" ? DATA : DATA.filter(d => d && d.t === state.skillType));
    setText("#statusCount", `技能口径 ${sr.rows.length} 项 · 样本 ${sr.sample} 条`);
  }
}

/* ---------------- KPI / 徽标同步（只写 #kpiXxx 数字位，不重建卡片） ---------------- */
function earliestLabel() {
  const list = DATA.filter(Boolean)
    .map(d => ({ d: d.d, left: daysLeft(d.d) }))
    .filter(x => x.left !== null && x.left >= 0)
    .sort((a, b) => a.left - b.left);
  return list.length ? list[0].d : "—";
}
function syncNoticeTag() {
  const tags = $$("#view-collect .page-head .right .tag");
  const tag = tags[1];
  if (tag) tag.textContent = `${NOTICES.length} 来源 · ${NOTICES.filter(n => stOf(n) === "ok").length} 已解析`;
}
function syncKPI() {
  const k = KPIS();
  setText("#kpiOpen", k.open);
  setText("#kpiWeekNew", k.weekNew);
  setText("#kpiUnits", k.units);
  setText("#kpiTypes", uniq(DATA.map(d => d && d.t)).length);
  setText("#kpiUrgent", k.urgent7);
  setText("#kpiEarliest", earliestLabel());
  setText("#kpiSaved", state.saved.size);

  // 已收藏卡片的脚注跟随数量变化
  const savedNum = $("#kpiSaved");
  const savedCard = savedNum && savedNum.closest ? savedNum.closest(".kpi") : null;
  const savedFt = savedCard ? savedCard.querySelector(".ft") : null;
  if (savedFt) {
    const cnt = {};
    STAGES.forEach(s => { cnt[s.k] = 0; });
    state.saved.forEach(i => { cnt[stageOf(i).k]++; });
    const parts = STAGES.filter(s => s.k !== "saved" && cnt[s.k]).map(s => `${s.lb} ${cnt[s.k]}`);
    savedFt.innerHTML = `<span class="dot"></span>${state.saved.size
      ? (parts.length ? parts.join(" · ") : `待投 ${cnt.saved}`)
      : "点星标即收藏"}`;
    savedFt.title = state.saved.size ? "点此只看已收藏的岗位" : "";
  }

  /* 卡片高亮 = 当前正被它筛着，点一下就知道自己在看什么 */
  $$(".kpi[data-quick]").forEach(card => {
    const on = card.dataset.quick === "all" ? state.quick === null : card.dataset.quick === state.quick;
    card.setAttribute("aria-pressed", String(on));
  });

  setText("#ctJobs", String(k.open));
  setText("#ctNotices", String(NOTICES.length));
  setText("#ctUnits", String(k.units));
  setText("#ctMine", String(state.saved.size));

  const sub = $("#view-lib .page-head .sub");
  if (sub) {
    const soonN = k.urgent7, savedN = state.saved.size;
    sub.innerHTML = soonN
      ? `现在有 <b>${soonN} 个</b> 岗位 7 天内截止，最早 <b>${earliestLabel()}</b> —— 先处理它们。本周新增 <b>${k.weekNew}</b> 个，你已收藏 <b>${savedN}</b> 个。`
      : `眼下没有 7 天内截止的岗位，可以从本周新增的 <b>${k.weekNew} 个</b> 里慢慢挑。你已收藏 <b>${savedN}</b> 个，全库共 <b>${k.total}</b> 个。`;
  }
  const tags = $$("#view-lib .page-head .right .tag");
  if (tags[0]) tags[0].innerHTML = `数据源 ${NOTICES.length} 份公告`;
  if (tags[1]) tags[1].innerHTML = `<span class="dot"></span>${TODAY} 已同步`;
  setText("#statusMeta", `数据源 ${NOTICES.length} 份公告 · 示例数据`);
  syncNoticeTag();
}

/* ---------------- 收藏 / 投递进度 ---------------- */
function paintDwStages() {
  const box = $("#dwStages"), note = $("#dwStageNote");
  if (!box) return;
  if (dwIndex == null) { box.innerHTML = ""; if (note) note.textContent = ""; return; }
  const cur = stageOf(dwIndex);
  const saved = state.saved.has(dwIndex);
  box.innerHTML = STAGES.map(s => `<button class="stchip" data-stage="${dwIndex}" data-st="${s.k}" aria-pressed="${cur.k === s.k}" title="${esc(s.hint)}">${esc(s.lb)}</button>`).join("");
  if (note) note.textContent = saved
    ? `当前：${cur.lb} · 上次更新 ${(state.prog[dwIndex] || {}).at || "—"}`
    : "还没进清单，点任意阶段即加入。";
}
function paintDwSave() {
  const b = $("#dwSave");
  if (!b) return;
  const saved = dwIndex != null && state.saved.has(dwIndex);
  b.setAttribute("aria-pressed", String(saved));
  b.textContent = saved ? "★ 已收藏" : "☆ 收藏";
  paintDwStages();
}
function syncSaveUI() {
  $$("[data-save]").forEach(b => {
    const i = Number(b.dataset.save);
    const saved = state.saved.has(i);
    b.setAttribute("aria-pressed", String(saved));
    const nm = b.dataset.name || "";
    if (b.classList.contains("star")) {
      b.textContent = saved ? "★" : "☆";
      b.setAttribute("aria-label", (saved ? "取消收藏" : "收藏") + (nm ? " " + nm : ""));
    } else {
      b.textContent = saved ? "★ 已收藏" : "☆ 收藏";
    }
  });
  paintDwSave();
}
function setSaved(i, on) {
  if (i == null || !byId.has(i)) return false;
  const next = on == null ? !state.saved.has(i) : !!on;
  if (next === state.saved.has(i)) { syncSaveUI(); return next; }
  if (next) {
    state.saved.add(i);
    if (!state.prog[i]) state.prog[i] = { st: "saved", at: TODAY };
  } else {
    state.saved.delete(i);
    delete state.prog[i];
  }
  persistSaved();
  syncSaveUI();
  syncKPI();
  if (state.view === "mine") renderMine();
  return next;
}
/* 推进 / 回退阶段。没在清单里的岗位，点阶段等于「收进来 + 定阶段」。 */
function setStage(i, st) {
  if (i == null || !byId.has(i) || !STAGE_I[st]) return false;
  const had = state.saved.has(i);
  const cur = state.prog[i];
  if (had && cur && cur.st === st) return false;
  state.saved.add(i);
  state.prog[i] = { st, at: TODAY };
  persistSaved();
  syncSaveUI();
  syncKPI();
  render();
  if (state.view === "mine") { renderMine(); syncStatusText(); }
  const d = byId.get(i);
  toast(`${d ? d.r : "岗位"} → ${STAGE_I[st].lb}${had ? "" : "（已加入投递清单）"}`);
  return true;
}
function setSavedMany(list, on) {
  if (!list.length) return 0;
  list.forEach(d => {
    if (on) {
      state.saved.add(d.i);
      if (!state.prog[d.i]) state.prog[d.i] = { st: "saved", at: TODAY };
    } else {
      state.saved.delete(d.i);
      delete state.prog[d.i];
    }
  });
  persistSaved();
  syncSaveUI();
  syncKPI();
  if (state.view === "mine") renderMine();
  return list.length;
}

/* ---------------- toast ---------------- */
function toast(msg) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("on");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("on"), 2200);
}

/* ---------------- 剪贴板 ---------------- */
function legacyCopy(text) {
  let ok = false;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "0";
  document.body.appendChild(ta);
  try { ta.select(); ta.setSelectionRange(0, ta.value.length); ok = document.execCommand("copy"); }
  catch (e) { ok = false; }
  document.body.removeChild(ta);
  return ok;
}
async function writeClipboard(text) {
  const t = String(text == null ? "" : text);
  if (!t) return false;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) { /* 回退 */ }
  }
  return legacyCopy(t);
}
async function copyAndToast(text, okMsg, failMsg) {
  const ok = await writeClipboard(text);
  toast(ok ? (okMsg || "已复制") : (failMsg || "复制失败：浏览器拒绝了剪贴板权限，请手动选中复制"));
  return ok;
}
function withScheme(s) {
  const v = String(s == null ? "" : s).trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[\w.-]+\.[a-z]{2,}([/:?#]|$)/i.test(v)) return "https://" + v.replace(/^\/+/, "");
  return "";
}
function noticeUrl(n) {
  if (!n) return "";
  return withScheme(n.url) || withScheme(n.src);
}
function directJobUrl(d) {
  if (!d) return "";
  if (d.url) return withScheme(d.url);
  if (d.w && /^https?:\/\//i.test(d.w)) return withScheme(d.w);
  return "";
}
function jobUrl(d) {
  if (!d) return "";
  if (d.url) { const u = withScheme(d.url); if (u) return u; }
  if (d.w && /^https?:\/\//i.test(d.w)) return d.w;
  const n = NOTICES.filter(x => x.u === d.u).map(x => noticeUrl(x)).filter(Boolean)[0];
  return n || "";
}
function copyTarget(d) {
  return jobUrl(d) || d.w || `${d.u || ""} ${d.r || ""}`.trim();
}

/* ---------------- CSV ---------------- */
function csvDownload(head, rows, filename) {
  const body = rows.map(r => r.map(v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`).join(","));
  const blob = new Blob(["\ufeff" + [head.join(",")].concat(body).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return rows.length;
}
function exportCsv() {
  const list = filtered();
  if (!list.length) { toast("当前筛选下没有岗位可导出"); return; }
  const n = csvDownload(
    ["单位", "岗位", "性质", "专业", "学历", "经验", "名额", "截止", "报名入口", "城市"],
    list.map(d => [d.u, d.r, d.t, d.m, d.e, d.x, d.n, d.d, d.w, d.city]),
    `starta-岗位库-${list.length}条.csv`
  );
  toast(`已导出 ${n} 条岗位 CSV`);
}

/* ---------------- 抽屉 ---------------- */
let dwIndex = null;
let dwReturn = null;

function openDrawer(i, trigger) {
  const d = byId.get(i);
  if (!d) return;
  dwIndex = i;
  dwReturn = trigger && trigger.focus ? trigger : document.activeElement;
  setText("#dwRole", d.r);
  setText("#dwUnit", `${d.u} · ${d.city}`);
  setText("#dwType", d.t);
  const tag = $("#dwType");
  if (tag) tag.dataset.t = d.t || "";
  const kv = $("#dwKv");
  if (kv) kv.innerHTML = [
    ["专业", d.m], ["学历", d.e], ["经验", d.x], ["名额", `${d.n} 人`],
    ["截止", d.d], ["报名入口", d.w]
  ].map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
  setText("#dwDesc", d.desc);
  const left = daysLeft(d.d);
  const meter = $("#dwMeter");
  if (meter) {
    if (left === null) {
      meter.style.width = "100%"; meter.style.opacity = ".3";
      setText("#dwAxis", "长期开放，随到随投"); setText("#dwPct", "开放");
    } else if (left <= 0) {
      meter.style.width = "100%"; meter.style.opacity = ".3";
      setText("#dwAxis", "报名窗口已关闭"); setText("#dwPct", "已截止");
    } else {
      meter.style.opacity = "1";
      meter.style.width = Math.max(6, Math.min(100, Math.round(left / 30 * 100))) + "%";
      setText("#dwAxis", "距截止日"); setText("#dwPct", `剩 ${left} 天`);
    }
  }
  paintDwSave();
  const go = $("#dwGo");
  if (go) go.textContent = directJobUrl(d) ? "前往报名" : "查看公告原文";
  const drawer = $("#drawer");
  if (drawer) { drawer.inert = false; drawer.classList.add("on"); drawer.setAttribute("aria-hidden", "false"); }
  const scrim = $("#scrim");
  if (scrim) scrim.classList.add("on");
  const close = $("#dwClose");
  if (close) close.focus({ preventScroll: true });
}
function closeDrawer() {
  const drawer = $("#drawer");
  if (!drawer || !drawer.classList.contains("on")) return;
  drawer.classList.remove("on");
  drawer.setAttribute("aria-hidden", "true");
  drawer.inert = true;
  const scrim = $("#scrim");
  if (scrim) scrim.classList.remove("on");
  dwIndex = null;
  const back = dwReturn;
  dwReturn = null;
  if (back) {
    requestAnimationFrame(() => {
      if (back.isConnected) { try { back.focus({ preventScroll: true }); } catch (e) { /* 忽略 */ } }
    });
  }
}
function openJobUrl(d) {
  const u = jobUrl(d);
  if (!u) { toast("这条岗位没有可打开的公告或报名地址"); return; }
  window.open(u, "_blank", "noopener");
}

/* ---------------- 视图切换 ---------------- */
const VIEW_LABEL = { lib: "岗位库", collect: "公告采集", units: "单位库", mine: "我的投递", skill: "技能剖面" };
function setView(v, opts) {
  if (!VIEW_LABEL[v]) v = "lib";
  state.view = v;
  $$(".main .page").forEach(el => { el.hidden = el.id !== "view-" + v; });
  $$(".navi a").forEach(a => {
    if (a.dataset.view === v) a.setAttribute("aria-current", "page");
    else if (a.dataset.view) a.removeAttribute("aria-current");
  });
  setText(".topbar .crumb b", VIEW_LABEL[v]);
  /* 状态栏跟着当前视图走，别让技能剖面底下还留着「显示 7 / 147 条」 */
  if (v === "lib") syncCountText(filtered());
  else if (v === "collect") setText("#statusCount", `采集 ${NOTICES.length} 条公告`);
  else if (v === "units") setText("#statusCount", `聚合 ${typeof S.unitsOf === "function" ? (S.unitsOf() || []).length : new Set(DATA.map(d => d.u)).size} 家单位`);
  else if (v === "mine") setText("#statusCount", mineStatus());
  else if (v === "skill") {
    const sr = skillRows(state.skillType === "全部" ? DATA : DATA.filter(d => d && d.t === state.skillType));
    setText("#statusCount", `技能口径 ${sr.rows.length} 项 · 样本 ${sr.sample} 条`);
  }
  if (v === "collect") { renderCitems(); renderCinfo(); }
  else if (v === "units") renderUnits();
  else if (v === "mine") renderMine();
  else if (v === "skill") renderSkill();
  if (!(opts && opts.silent)) {
    try {
      const u = new URL(location.href);
      u.searchParams.set("view", v);
      history.replaceState(null, "", u.href);
    } catch (e) { /* file:// 或权限受限时忽略 */ }
  }
}
function viewFromUrl() {
  try {
    const v = new URLSearchParams(location.search).get("view");
    return VIEW_LABEL[v] ? v : "lib";
  } catch (e) { return "lib"; }
}

/* ---------------- 单位库 ---------------- */
function unitDue(u) {
  const ds = DATA.filter(d => d && d.u === u && dueRank(d.d) < 9999)
    .map(d => d.d).sort((a, b) => dueRank(a) - dueRank(b));
  return ds[0] || "";
}
function normUnit(x) {
  const u = x.u || x.unit || x.name || "";
  const roles = Array.isArray(x.roles)
    ? x.roles.map(r => typeof r === "string" ? r : (r && (r.r || r.name)) || "").filter(Boolean)
    : [];
  const nRaw = Number(x.n);
  return {
    u,
    t: x.t || x.type || "",
    city: x.city || "",
    n: isFinite(nRaw) ? nRaw : (roles.length || DATA.filter(d => d && d.u === u).length),
    roles,
    due: x.due || x.d || unitDue(u)
  };
}
function unitGroups() {
  let arr = [];
  if (typeof S.unitsOf === "function") {
    try {
      const u = S.unitsOf();
      if (Array.isArray(u) && u.length) arr = u.map(normUnit);
    } catch (e) { /* 兜底 */ }
  }
  if (!arr.length) {
    const map = new Map();
    DATA.forEach(d => {
      if (!d || !d.u) return;
      if (!map.has(d.u)) map.set(d.u, { u: d.u, t: d.t || "", city: d.city || "", n: 0, roles: [], due: "" });
      const g = map.get(d.u);
      g.n++;
      if (d.r) g.roles.push(d.r);
      if (dueRank(d.d) < dueRank(g.due)) g.due = d.d;
    });
    arr = Array.from(map.values());
  }
  arr.forEach(g => { if (!g.due) g.due = unitDue(g.u); });
  return arr;
}
function renderUnits() {
  const head = $("#uhead"), box = $("#urows");
  if (!head || !box) return;
  const groups = unitGroups();
  const typeCount = new Map();
  groups.forEach(g => typeCount.set(g.t, (typeCount.get(g.t) || 0) + 1));
  const chipBox = $("#unitchips");
  if (chipBox) {
    chipBox.innerHTML = ["全部"].concat(TYPES).map(t => {
      const n = t === "全部" ? groups.length : (typeCount.get(t) || 0);
      return `<button class="chip" data-utype="${esc(t)}" aria-pressed="${String(state.uType === t)}">${esc(t)}<span class="ct">${n}</span></button>`;
    }).join("");
  }
  const list = groups
    .filter(g => state.uType === "全部" || g.t === state.uType)
    .sort((a, b) => b.n - a.n || String(a.u).localeCompare(String(b.u), "zh"));
  setText("#uCount", list.length);
  // 6 列：单位（含城市）/ 性质 / 岗位数 / 最近截止 / 在招岗位 / 操作
  // 顺序按 styles.css 里 #view-units 的列宽模板（200/110/96/88/1fr/116）排，
  // 让「截止」拿窄列、「岗位」拿 1fr，避免岗位名被压成 88px 截断。
  head.innerHTML = [
    ["c-unit", "单位 / 城市"],
    ["c-type", "性质"],
    ["c-cnt", "岗位数"],
    ["c-due", "最近截止"],
    ["c-major", "在招岗位"],
    ["c-op", "操作"]
  ].map(h => `<span class="${h[0]}">${esc(h[1])}</span>`).join("");
  box.innerHTML = list.length ? list.map(g => {
    const roles = g.roles || [];
    const roleText = roles.length ? roles.slice(0, 3).join("、") + (roles.length > 3 ? ` 等 ${roles.length} 个` : "") : "—";
    return `<div class="row" data-unit="${esc(g.u)}">
      <span class="c c-unit" title="${esc(g.u)}${g.city ? " · " + esc(g.city) : ""}">${esc(g.u)}<small class="u-city"> · ${esc(g.city || "—")}</small></span>
      <span class="c c-type">${g.t ? `<span class="tag" data-t="${esc(g.t)}">${esc(g.t)}</span>` : "—"}</span>
      <span class="c c-cnt">${g.n}</span>
      <span class="c c-due ${isSoon(g.due) ? "soon" : ""}">${esc(g.due || "—")}</span>
      <span class="c c-major" title="${esc(roleText)}">${esc(roleText)}</span>
      <span class="c c-op"><button class="go" data-unit-go="${esc(g.u)}">看岗位</button></span>
    </div>`;
  }).join("")
    : `<div class="empty"><b>这个性质下还没有单位</b>换一个筛选试试。</div>`;
}
function gotoUnit(u) {
  state.type = "全部";
  state.major = "全部专业";
  state.edu = "全部学历";
  state.q = u || "";
  const q = $("#q"); if (q) q.value = state.q;
  mountFilters();
  persistFilters();
  setView("lib");
  render();
  toast(`已筛选「${u}」的全部岗位`);
}

/* ---------------- 我的投递 ---------------- */
function savedJobs() {
  const list = [];
  DATA.forEach((d, i) => { if (d && state.saved.has(i)) list.push(Object.assign({}, d, { i })); });
  if (list.length !== state.saved.size) {
    const valid = new Set(list.map(d => d.i));
    state.saved.forEach(i => { if (!valid.has(i)) state.saved.delete(i); });
    persistSaved();
    syncKPI();
  }
  return list;
}
/* 距离「上次更新」过了几天；at 与 TODAY 同为 MM-DD */
function ageOf(i) {
  const at = (state.prog[i] || {}).at;
  if (!at) return null;
  const l = daysLeft(at);
  return l == null ? null : Math.max(0, -l);
}
function renderMine() {
  const head = $("#mhead"), box = $("#mrows"), fun = $("#mfunnel");
  if (!head || !box) return;
  // 跟进清单：勾选 / 单位 / 岗位 / 阶段 / 停留 / 截止 / 专业 / 学历·经验 / 名额 / 操作
  head.innerHTML = [
    ["c-check", ""],
    ["c-unit", "单位"],
    ["c-role", "岗位"],
    ["c-stage", "阶段"],
    ["c-age", "停留"],
    ["c-due", "截止"],
    ["c-major", "专业"],
    ["c-dim c-edu", "学历 / 经验"],
    ["c-num", "名额"],
    ["c-op", "操作"]
  ].map(h => `<span class="${h[0]}">${esc(h[1])}</span>`).join("");

  const list = savedJobs();

  /* 漏斗：五档各多少条，点一次筛，再点取消 */
  if (fun) {
    fun.hidden = !list.length;
    if (!list.length) { fun.innerHTML = ""; }
    else {
      const n = {};
      STAGES.forEach(s => { n[s.k] = 0; });
      list.forEach(d => { n[stageOf(d.i).k]++; });
      fun.innerHTML = STAGES.map(s => {
        const on = state.mineSt === s.k;
        const w = Math.round(n[s.k] / list.length * 100);
        return `<button class="fstage${on ? " on" : ""}" data-mst="${s.k}" aria-pressed="${on}" title="${esc(s.hint)}">
          <span class="fst-l">${esc(s.lb)}</span>
          <span class="fst-n">${n[s.k]}</span>
          <span class="fst-bar"><i style="width:${w}%"></i></span>
        </button>`;
      }).join("");
    }
  }

  const shown = state.mineSt ? list.filter(d => stageOf(d.i).k === state.mineSt) : list;
  box.innerHTML = shown.length ? shown.map(d => {
    const st = stageOf(d.i), age = ageOf(d.i), left = daysLeft(d.d);
    const ageTxt = age == null ? "—" : age === 0 ? "今天" : age + " 天前";
    const dueCls = left == null ? "" : left < 0 ? " expired" : left <= 7 ? " soon" : "";
    const dueTxt = left == null ? `${esc(d.d)}<small>长期</small>`
      : left < 0 ? `${esc(d.d)}<small>已过</small>`
        : left === 0 ? `${esc(d.d)}<small>今天</small>`
          : `${esc(d.d)}<small>${left} 天</small>`;
    return `<div class="row" data-i="${d.i}">
      <span class="c c-check"><input type="checkbox" data-check="${d.i}" ${state.sel.has(d.i) ? "checked" : ""} aria-label="选择 ${esc(d.u)} ${esc(d.r)}"></span>
      <span class="c c-unit" title="${esc(d.u)}">${esc(d.u)}</span>
      <span class="c c-role">${esc(d.r)}</span>
      <span class="c c-stage"><button class="stpill" data-adv="${d.i}" data-st="${st.k}" title="${esc(st.hint)} · 点一下推进到下一档">${esc(st.lb)}</button></span>
      <span class="c c-age" title="上次更新 ${esc((state.prog[d.i] || {}).at || "—")}">${ageTxt}</span>
      <span class="c c-due${dueCls}">${dueTxt}</span>
      <span class="c c-major">${esc(d.m)}</span>
      <span class="c c-dim c-edu">${esc(d.e)} · ${esc(d.x)}</span>
      <span class="c c-num">${d.n} 人</span>
      <span class="c c-op"><button class="go" data-open="${d.i}">详情</button><button class="go star" data-save="${d.i}" data-name="${esc(d.r)}" aria-pressed="true" aria-label="取消收藏 ${esc(d.r)}">★</button></span>
    </div>`;
  }).join("")
    : (state.mineSt
      ? `<div class="empty"><b>「${esc(STAGE_I[state.mineSt].lb)}」这一档还没有岗位</b>点上面亮着的阶段卡回到全部，或者去岗位库把新岗位收进来。</div>`
      : `<div class="empty"><b>还没有收藏的岗位</b>去岗位库点一下 ☆，或者在任意岗位的展开行里点一个投递阶段，收进来的岗位会存在本地，刷新也不丢。</div>`);
}
function exportMine() {
  const list = savedJobs();
  if (!list.length) { toast("还没有收藏的岗位，先去岗位库点个星"); return; }
  const n = csvDownload(
    ["单位", "岗位", "投递阶段", "上次更新", "停留天数", "性质", "专业", "学历", "经验", "名额", "截止", "报名入口", "城市"],
    list.map(d => {
      const age = ageOf(d.i);
      return [d.u, d.r, stageOf(d.i).lb, (state.prog[d.i] || {}).at || "", age == null ? "" : age,
        d.t, d.m, d.e, d.x, d.n, d.d, d.w, d.city];
    }),
    `starta-我的投递-${list.length}条.csv`
  );
  toast(`已导出投递清单 ${n} 条`);
}

/* ---------------- 技能剖面 ---------------- */
function countBy(getKey) {
  const m = new Map();
  DATA.forEach(d => {
    if (!d) return;
    const k = getKey(d);
    if (!k) return;
    m.set(k, (m.get(k) || 0) + 1);
  });
  return Array.from(m, ([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n);
}
/* skillStats() 兼容数组 [{k,v}] / 对象 {k:v} / 二元组数组；宽度按样本总量算百分比 */
function skillRows(list) {
  const src = Array.isArray(list) ? list : DATA;
  const toRow = x => {
    if (Array.isArray(x)) return { label: String(x[0] == null ? "" : x[0]), n: Number(x[1]) || 0 };
    if (x && typeof x === "object") {
      const label = x.label || x.name || x.k || x.mf || x.key || "";
      const n = x.n != null ? x.n : x.count != null ? x.count : x.value != null ? x.value : x.v;
      return { label: String(label), n: Number(n) || 0 };
    }
    return null;
  };
  let rows = [];
  if (typeof S.skillStats === "function") {
    try {
      const ss = S.skillStats(src);
      if (Array.isArray(ss)) rows = ss.map(toRow).filter(r => r && r.label);
      else if (ss && typeof ss === "object") rows = Object.keys(ss).map(k => ({ label: k, n: Number(ss[k]) || 0 })).filter(r => r.label);
    } catch (e) { /* 兜底 */ }
  }
  if (!rows.length) {
    const m = new Map();
    src.forEach(d => { if (d && d.mf) m.set(d.mf, (m.get(d.mf) || 0) + 1); });
    rows = Array.from(m, ([label, n]) => ({ label, n }));
  }
  rows = rows.filter(r => r.n > 0);
  rows.sort((a, b) => b.n - a.n);
  const sample = src.length || (S.META && Number(S.META.sample)) || rows.reduce((m, r) => Math.max(m, r.n), 1);
  return {
    sample,
    rows: rows.map(r => Object.assign({}, r, {
      pct: Math.max(r.n > 0 ? 3 : 0, Math.round(r.n / Math.max(sample, 1) * 100))
    }))
  };
}
/* 技能剖面：按单位性质切一刀，看同一份要求在不同体制里的密度 */
function skillTypeList() { return ["全部"].concat(TYPES); }
function renderSkill() {
  const box = $("#skillBars");
  if (!box) return;
  const types = skillTypeList();
  const cur = types.indexOf(state.skillType) >= 0 ? state.skillType : "全部";
  state.skillType = cur;
  const base = cur === "全部" ? DATA : DATA.filter(d => d && d.t === cur);
  const data = skillRows(base);
  const tb = $("#skillTypes");
  if (tb) {
    tb.innerHTML = types.map(t => {
      const n = t === "全部" ? DATA.length : DATA.filter(d => d && d.t === t).length;
      return `<button class="chip" data-stype="${esc(t)}" aria-pressed="${t === cur}">${esc(t)}<span class="ct">${n}</span></button>`;
    }).join("");
  }
  const top = data.rows.slice(0, 3);
  const tight = data.rows[data.rows.length - 1];
  let note = "";
  if (data.rows.length >= 3) {
    note = `<p class="sk-note">看两条边：<b>${esc(top.map(r => r.label).join("、"))}</b> 是最硬的几条门槛（各命中 ${top.map(r => r.n).join("、")} 条）；<b>${esc(tight.label)}</b> 只有 ${tight.n} 条，属于加分项而非门槛。${cur === "全部" ? "" : `这是 ${esc(cur)} 的口径，换一类会发现扎堆的地方不一样。`}</p>`;
  } else if (data.rows.length) {
    note = `<p class="sk-note">${esc(cur)} 样本只有 ${data.sample} 条，最常出现的是 <b>${esc(top[0].label)}</b>（${top[0].n} 条），样本小，别当结论用。</p>`;
  }
  box.innerHTML = `<div class="sk-h">技能命中分布 · ${cur === "全部" ? "全部性质" : esc(cur)} · 样本 ${data.sample} 条</div>` + (data.rows.length
    ? data.rows.map(r => `<div class="bar-row" title="${esc(r.label)}：命中 ${r.n} / ${data.sample}（${r.pct}%）">
      <span class="bar-label">${esc(r.label)}</span><i class="bar-fill" style="width:${r.pct}%"></i><span class="bar-val">${r.n}</span>
    </div>`).join("") + note
    : `<div class="empty"><b>这一类还没有样本</b>换一类，或者先去岗位库补几条再看。</div>`);
}

/* ---------------- 总渲染 ---------------- */
function render() {
  const list = filtered();
  pruneSel(list);
  paintRows(list);
  syncCountText(list);
  syncTypebarCounts();
  syncSortUI();
  syncFiltersUI();
  syncBulk(list);
  syncKPI();
  if (state.view === "units") renderUnits();
  else if (state.view === "mine") renderMine();
  else if (state.view === "skill") renderSkill();
}

/* ======================================================================
   公告采集状态机
   st: pending → parsing(约 1.2s，列表项显示进度) → ok / error(原因 + 重试)
   ====================================================================== */
let curNotice = NOTICES.length ? (NOTICES[0] && NOTICES[0].id) : null;
let cq = "";
let exOpen = false;
let noticeSeq = 100;
const crawlTimers = new Map();

function stOf(n) {
  const s = n && n.st;
  if (s === "parsed") return "ok";
  if (s === "ok" || s === "parsing" || s === "pending" || s === "error") return s;
  return "pending";
}
function statusInfo(n) {
  const st = stOf(n);
  if (st === "ok") return { cls: "ok", text: "已解析" };
  if (st === "parsing") return { cls: "wait", text: `解析中 ${n.prog || 0}%` };
  if (st === "error") return { cls: "wait", text: "解析失败" };
  return { cls: "wait", text: "排队中" };
}
function currentNotice() {
  let n = NOTICES.filter(x => x.id === curNotice)[0];
  if (!n) { n = NOTICES[0]; if (n) curNotice = n.id; }
  return n || null;
}
function unitRoles(n) {
  if (!n) return [];
  return DATA.map((d, i) => Object.assign({}, d, { i })).filter(d => d.u === n.u);
}
function rolesOfNotice(n) {
  const all = DATA.map((d, i) => Object.assign({}, d, { i }));
  const want = NOTICE_ROLES[n.id];
  const mine = all.filter(d => d._n === n.id);
  if (Array.isArray(want)) {
    // 公告映射的岗位 + 后来真正解析并入的岗位取并集，避免重新解析后导出漏行
    const mapped = all.filter(d => d.u === n.u && want.indexOf(d.r) >= 0);
    const seen = new Set(mapped.map(d => d.i));
    return mapped.concat(mine.filter(d => !seen.has(d.i)));
  }
  if (mine.length) return mine;
  return all.filter(d => d.u === n.u);
}
function filesHtml(n) {
  const names = [`${n.u}-岗位表.xlsx`, `${n.u}-报名登记表.docx`, `${n.u}-公告原文.html`].slice(0, Math.max(0, Number(n.files) || 0));
  if (!names.length) return "";
  return names.map(x => `<span class="file"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>${esc(x)}</span>`).join("");
}
function citemInner(n) {
  const info = statusInfo(n);
  const st = stOf(n);
  const prog = st === "parsing" || st === "pending"
    ? `<div class="meter" style="margin-top:7px"><i style="width:${st === "parsing" ? (n.prog || 0) : 4}%"></i></div>`
    : "";
  const err = st === "error"
    ? `<div style="margin-top:6px;font-size:.76rem;line-height:1.5;color:var(--accent)">${esc(n.reason || "未知原因")}</div>`
    : "";
  return `<div class="t">${esc(n.title)}</div>
    <div class="m"><span>${esc(n.u)}</span><span>${esc(n.date)}</span>
      <span class="st ${info.cls}"${st === "error" ? ' style="color:var(--accent)"' : ""}><i></i>${esc(info.text)}</span></div>${prog}${err}`;
}
function renderCitems() {
  const box = $("#citems");
  if (!box) return;
  const kw = cq.toLowerCase();
  const items = NOTICES.filter(n => !kw || `${n.u || ""} ${n.title || ""}`.toLowerCase().indexOf(kw) >= 0);
  box.innerHTML = items.length
    ? items.map(n => `<button class="citem" data-n="${esc(n.id)}" data-st="${stOf(n)}" aria-current="${n.id === curNotice ? "true" : "false"}" aria-selected="${n.id === curNotice ? "true" : "false"}" role="option">${citemInner(n)}</button>`).join("")
    : `<div class="cempty">没有匹配的公告</div>`;
  setText("#cCount", `${items.length} / ${NOTICES.length}`);
  syncNoticeTag();
  // 公告数量变化时，侧栏徽标与 KPI 一起刷新（采集状态机 ok / 失败都会走这里）
  syncKPI();
}
function paintNotice(n) {
  const b = document.querySelector(`#citems .citem[data-n="${n.id}"]`);
  if (!b) { renderCitems(); return; }
  b.setAttribute("data-st", stOf(n));
  b.innerHTML = citemInner(n);
}
function noticeLogs(n, roles) {
  const st = stOf(n);
  if (st === "ok") return `<ol class="tl">
    <li class="ok"><span>${esc(n.date)}</span>抓取公告页 · 200 OK</li>
    <li class="ok"><span>${esc(n.date)}</span>下载附件 ${Number(n.files) || 0} 个 → ${Number(n.files) ? esc(`${n.u}-岗位表.xlsx`) : "无附件"}</li>
    <li class="ok"><span>${esc(n.date)}</span>解析岗位表 · 提取 ${roles.length} 条岗位 · 去重 0 条</li>
    <li class="ok"><span>${esc(n.date)}</span>写入岗位库 · 已可在「岗位库」检索</li>
  </ol>`;
  if (st === "error") return `<ol class="tl">
    <li class="wait"><span>—</span>抓取任务已终止</li>
    <li class="wait" style="color:var(--accent)"><span>!</span>${esc(n.reason || "未知原因")}</li>
    <li class="wait"><span>—</span>修正地址后可点「重试」重新走一遍</li>
  </ol>`;
  if (st === "parsing") return `<ol class="tl">
    <li class="ok"><span>—</span>抓取公告页 · 进行中</li>
    <li class="ok"><span>—</span>解析岗位表 · 进度 ${n.prog || 0}%</li>
    <li class="wait"><span>—</span>解析完成后自动写入岗位库</li>
  </ol>`;
  return `<ol class="tl">
    <li class="ok"><span>—</span>已加入采集队列 · 排队第 1 位</li>
    <li class="wait"><span>—</span>等待抓取线程领取任务</li>
    <li class="wait"><span>—</span>解析完成后自动写入岗位库</li>
  </ol>`;
}
function renderCinfo() {
  const box = $("#cinfo");
  if (!box) return;
  const n = currentNotice();
  if (!n) {
    box.innerHTML = `<div class="cempty">还没有公告。粘一条地址，点「采集」开始。</div>`;
    return;
  }
  const st = stOf(n);
  const busy = st === "parsing" || st === "pending";
  const roles = st === "ok" ? rolesOfNotice(n) : [];
  const rel = NOTICES.filter(x => x.u === n.u && x.id !== n.id);
  const others = st === "ok" ? unitRoles(n).filter(o => !roles.some(r => r.i === o.i)) : [];
  const url = noticeUrl(n);
  const info = statusInfo(n);

  const rolesBlock = st === "ok"
    ? (roles.length
      ? `<table class="mini"><thead><tr><th>岗位</th><th>专业</th><th>学历 / 经验</th><th>名额</th><th>截止</th></tr></thead><tbody>
          ${roles.map(r => `<tr data-open="${r.i}"><td>${esc(r.r)}</td><td>${esc(r.m)}</td><td>${esc(r.e)} · ${esc(r.x)}</td><td>${r.n} 人</td><td>${esc(r.d)}</td></tr>`).join("")}
        </tbody></table>`
      : `<div class="cempty">解析完成，但没提取到岗位。检查一下原文的岗位表是不是扫描件。</div>`)
    : st === "error"
      ? `<div class="cempty" style="color:var(--accent);padding:36px 20px">${esc(n.reason || "未知原因")}</div>`
      : `<div class="cempty" style="padding:30px 20px">
          <div>正在抓取与解析，进度 <b class="num cprog-lb" style="color:var(--accent);font-weight:600">${n.prog || 0}%</b></div>
          <div class="meter cprogress" style="margin:12px auto 0;max-width:320px"><i style="width:${n.prog || 0}%"></i></div>
        </div>`;

  box.innerHTML = `
    <h2>${esc(n.title)}</h2>
    <div class="src">${esc(n.src || url)}</div>
    <div class="sec"><div class="dl">
      <div><div class="k">来源单位</div><div class="v">${esc(n.u)}</div></div>
      <div><div class="k">发布日期</div><div class="v">${TODAY_DATE.getFullYear()}-${esc(n.date)}</div></div>
      <div><div class="k">提取岗位</div><div class="v">${st === "ok" ? `${roles.length} 个` : "—"}</div></div>
      <div><div class="k">采集状态</div><div class="v"><span class="st ${info.cls}"${st === "error" ? ' style="color:var(--accent)"' : ""}><i></i>${esc(info.text)}</span></div></div>
    </div></div>
    <div class="sec"><h3>附件 / FILES · ${Number(n.files) || 0} 个</h3>
      <div class="files">${Number(n.files) ? filesHtml(n) : `<span class="st wait"><i></i>${st === "ok" ? "这条公告没有附件" : "尚未下载附件，等待解析"}</span>`}</div>
    </div>
    <div class="sec"><h3>提取出的岗位 / ROLES</h3>${rolesBlock}</div>
    <div class="sec"><h3>采集日志 / LOG</h3>${noticeLogs(n, roles)}</div>
    <div class="duo">
      <div>
        <button class="fold" data-fold type="button" aria-expanded="${exOpen}">
          <span>原文摘要 / EXCERPT</span>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        <div class="exwrap" ${exOpen ? "" : "hidden"}>
          ${n.sum ? `<blockquote class="ex">${esc(n.sum)}</blockquote>` : `<p class="ex-empty">${st === "ok" ? "这条公告没有摘要。" : "待解析，摘要生成后会显示在这里。"}</p>`}
        </div>
      </div>
      <div>
        <h3>同单位其他公告 / MORE</h3>
        ${rel.length ? `<div class="mrel">${rel.slice(0, 4).map(r => `<button data-n="${esc(r.id)}" type="button"><span>${esc(r.title)}</span><i>${esc(r.date)}</i></button>`).join("")}</div>`
          : `<p class="ex-empty">该单位只有这一条公告。采集到新的会自动出现在这里。</p>`}
      </div>
    </div>
    ${others.length ? `<div class="sec">
      <h3>该单位其他岗位 / UNIT ROLES · ${others.length}</h3>
      <div class="ugrid">
        ${others.slice(0, 6).map(o => `<button class="ucard" data-open="${o.i}" type="button">
          <div class="ut">${esc(o.r)}</div>
          <div class="um">${esc(o.e)} · ${esc(o.x)} · 招 ${o.n} 人</div>
          <div class="ud">截止 ${esc(o.d)} <span>·</span> ${esc(o.w)}</div>
        </button>`).join("")}
      </div>
    </div>` : ""}
    <div class="cbar">
      <button class="btn" id="reparse"${busy ? " disabled" : ""}>${st === "error" ? "重试" : busy ? "解析中…" : "重新解析"}</button>
      <button class="btn ghost" id="expNotice"${st === "ok" ? "" : " disabled"}>导出岗位</button>
      <span class="sp"></span>
      <button class="btn primary" id="openSrc"${url ? "" : " disabled"}>打开原文</button>
    </div>`;
}

/* ---- 采集：创建 / 状态机 ---- */
function hashStr(s) {
  let h = 0;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function createNotice(url) {
  const title = (() => {
    try {
      const u = new URL(url);
      const seg = u.pathname.split("/").filter(Boolean).pop() || "";
      const tail = seg ? decodeURIComponent(seg).replace(/\.html?$/i, "") : "";
      return `${u.hostname}${tail ? " / " + tail : ""} 公告`;
    } catch (e) {
      return "新采集任务 · " + url.slice(0, 40);
    }
  })();
  const n = {
    id: "x" + (++noticeSeq),
    u: "待识别单位",
    title,
    src: url,
    url,
    date: TODAY,
    st: "pending",
    files: 0,
    prog: 0,
    reason: "",
    sum: ""
  };
  NOTICES.unshift(n);
  return n;
}
function clearCrawlTimers(id) {
  const timers = crawlTimers.get(id) || [];
  timers.forEach(t => { clearTimeout(t); clearInterval(t); });
  crawlTimers.delete(id);
}
function runParse(n) {
  clearCrawlTimers(n.id);
  // 地址仍不合法时不做无意义的「假装解析」，直接停在失败态等用户换地址
  if (!withScheme(n.url || n.src)) {
    n.st = "error";
    n.prog = 0;
    n.reason = "地址无效：必须以 http:// 或 https:// 开头，请重新粘一条公告地址。";
    paintNotice(n);
    if (n.id === curNotice) renderCinfo();
    toast("这条公告的地址仍然无效，请重新采集");
    return;
  }
  n.st = "pending";
  n.prog = 0;
  n.reason = "";
  paintNotice(n);
  if (n.id === curNotice) renderCinfo();
  const timers = [];
  timers.push(setTimeout(() => {
    if (stOf(n) !== "pending") return;
    n.st = "parsing";
    n.prog = 8;
    paintNotice(n);
    if (n.id === curNotice) renderCinfo();
    const tick = setInterval(() => {
      if (stOf(n) !== "parsing") { clearInterval(tick); return; }
      n.prog = Math.min(96, n.prog + 9);
      paintNotice(n);
      if (n.id === curNotice) {
        const lb = document.querySelector("#cinfo .cprog-lb");
        if (lb) lb.textContent = (n.prog || 0) + "%";
        const bar = document.querySelector("#cinfo .cprogress i");
        if (bar) bar.style.width = (n.prog || 0) + "%";
        /* 徽标也要跟着走，别停在进入 parsing 时的 8% */
        const st = document.querySelector("#cinfo .st");
        if (st) st.textContent = "解析中 " + (n.prog || 0) + "%";
      }
    }, 110);
    timers.push(tick);
    timers.push(setTimeout(() => {
      clearInterval(tick);
      n.prog = 100;
      finishParse(n);
    }, 1200));
  }, 240));
  crawlTimers.set(n.id, timers);
}
function guessUnit(n) {
  if (n.u && n.u !== "待识别单位") return n.u;
  const raw = String(n.url || n.src || "");
  const map = [
    [/sgcc|state-?grid/i, "国家电网"],
    [/10086|chinamobile/i, "中国移动"],
    [/cnpc|petrochina/i, "中国石油"],
    [/sinopec/i, "中国石化"],
    [/metro|subway|rail/i, "地铁集团"],
    [/hospital|wjw|wsjkw|health/i, "市卫生健康系统"],
    [/edu\.cn|university|college/i, "省属高校"],
    [/gzw|sasac/i, "市属国企"],
    [/bank/i, "市属银行"],
    [/power|energy/i, "能源集团"],
    [/gov\.cn/i, "市属事业单位"]
  ];
  for (let k = 0; k < map.length; k++) if (map[k][0].test(raw)) return map[k][1];
  try { return new URL(withScheme(raw)).hostname.replace(/^www\./, ""); } catch (e) { return "新采集单位"; }
}
const CRAWL_ROLES = [
  { r: "综合管理岗", m: "不限专业", mf: "不限", e: "本科", x: "不限", n: 2, city: "本地", desc: "负责综合事务、材料撰写与对外协调，专业不限，需通过统一笔试与面试。" },
  { r: "信息化技术岗", m: "计算机 / 软件工程", mf: "计算机", e: "本科", x: "1-3 年", n: 3, city: "本地", desc: "负责业务系统运维与数据接口开发，熟悉 SQL 与至少一门后端语言。" },
  { r: "财务审计岗", m: "会计学 / 财务管理", mf: "财会", e: "本科", x: "应届", n: 1, city: "本地", desc: "负责账务处理与内部审计配合，需熟悉企业会计准则，CPA 科目通过者优先。" },
  { r: "专业技术岗", m: "电气 / 自动化", mf: "电气", e: "本科", x: "应届", n: 4, city: "全国", desc: "一线技术岗位，接受轮班与项目地派驻，需通过体检与安全背景审查。" }
];
function pickRoles(n, unit) {
  const h = hashStr(n.url || n.src || n.id);
  const count = 2 + (h % 2);
  const start = h % CRAWL_ROLES.length;
  // 已有单位沿用它的性质，避免采集进来的岗位全变成「事业单位」
  const known = DATA.filter(x => x && x.u === unit)[0];
  const type = (known && known.t) || "事业单位";
  const out = [];
  for (let k = 0; k < count; k++) {
    const base = CRAWL_ROLES[(start + k) % CRAWL_ROLES.length];
    out.push(Object.assign({}, base, {
      t: type,
      u: unit,
      d: addDaysDate(30 + (h % 40) + k * 5),
      w: "公告原文 · 在线报名",
      n: base.n + (h % 3)
    }));
  }
  return out;
}
function mergeRoles(n) {
  const unit = guessUnit(n);
  n.u = unit;
  const roles = pickRoles(n, unit);
  // 这条公告上次解析出来的行 / 库里已有的「单位 + 岗位」都算重复，避免重复叠加
  const prev = [];
  const exists = new Map();
  DATA.forEach((d, i) => {
    if (!d) return;
    if (d._n === n.id) prev.push(i);
    if (d.u && d.r && !exists.has(d.u + "\u0000" + d.r)) exists.set(d.u + "\u0000" + d.r, i);
  });
  let added = 0;
  roles.forEach((r, k) => {
    const key = unit + "\u0000" + r.r;
    if (prev[k] != null) {
      Object.assign(DATA[prev[k]], r, { u: unit, _n: n.id });
    } else if (exists.has(key)) {
      // 该岗位已在库里，只标记归属，不新增行
      DATA[exists.get(key)]._n = DATA[exists.get(key)]._n || n.id;
    } else {
      const i = DATA.push(Object.assign({}, r, { _n: n.id })) - 1;
      exists.set(key, i);
      prev.push(i);
      added++;
    }
  });
  reindex();
  return { unit, added, total: roles.length };
}
function finishParse(n) {
  clearCrawlTimers(n.id); /* 解析收尾：定时器一并销账，别让 crawlTimers 只增不减 */
  n.st = "ok";
  n.prog = 100;
  n.reason = "";
  n.files = Math.max(1, hashStr(n.url || n.id) % 3);
  const merged = mergeRoles(n);
  n.sum = n.sum || `${merged.unit} 于 ${n.date} 发布的招聘公告，已抓取原文并抽取 ${merged.total} 条岗位；岗位要求与报名入口以公告原文为准。`;
  if (n.id === curNotice) renderCinfo();
  renderCitems();
  render();
  syncKPI();
  syncStatusText();
  toast(merged.added ? `解析完成：并入 ${merged.added} 个新岗位` : `解析完成：${merged.total} 个岗位均已在库中，已刷新要求`);
}
function startCrawl(raw) {
  const url = String(raw == null ? "" : raw).trim();
  if (!url) {
    toast("先粘一个公告地址，再点采集");
    const inp = $("#curl");
    if (inp) inp.focus();
    return null;
  }
  const n = createNotice(url);
  curNotice = n.id;
  const valid = /^https?:\/\/[^\s]+$/i.test(url);
  if (!valid) {
    n.st = "error";
    n.reason = /^https?:\/\//i.test(url) ? "地址里有空格或非法字符，请检查后重试" : "地址必须以 http:// 或 https:// 开头";
    renderCitems();
    renderCinfo();
    toast("采集失败：" + n.reason);
    const inp = $("#curl");
    if (inp) { inp.focus(); inp.select(); }
    return n;
  }
  const inp = $("#curl");
  if (inp) inp.value = "";
  renderCitems();
  runParse(n);
  toast("已受理，正在抓取公告…");
  return n;
}
function exportNoticeCsv(n) {
  if (!n) return;
  if (stOf(n) !== "ok") { toast("先解析成功，再导出岗位"); return; }
  const roles = rolesOfNotice(n);
  if (!roles.length) { toast("这条公告没有解析出岗位"); return; }
  const num = csvDownload(
    ["岗位", "专业", "学历", "经验", "名额", "截止", "城市", "报名入口"],
    roles.map(r => [r.r, r.m, r.e, r.x, r.n, r.d, r.city, noticeUrl(n)]),
    `starta-${n.u || "公告"}-岗位-${roles.length}条.csv`
  );
  toast(`已导出 ${num} 条岗位 CSV`);
}

/* ---------------- 事件绑定 ---------------- */
function bindEvents() {
  /* 岗位库筛选 */
  on("#typebar", "click", e => {
    const b = e.target.closest(".chip");
    if (!b) return;
    state.type = b.dataset.type;
    persistFilters();
    render();
  });
  on("#skillTypes", "click", e => {
    const b = e.target.closest(".chip");
    if (!b) return;
    state.skillType = b.dataset.stype;
    renderSkill();
    const sr = skillRows(state.skillType === "全部" ? DATA : DATA.filter(d => d && d.t === state.skillType));
    setText("#statusCount", `技能口径 ${sr.rows.length} 项 · 样本 ${sr.sample} 条`);
  });
  on("#major", "change", e => { state.major = e.target.value; persistFilters(); render(); });
  on("#edu", "change", e => { state.edu = e.target.value; persistFilters(); render(); });
  on("#q", "input", e => { state.q = e.target.value.trim(); persistFilters(); render(); });
  on("#sort", "change", e => setSort(e.target.value));
  on("#resetBtn", "click", () => {
    state.type = "全部";
    state.major = "全部专业";
    state.edu = "全部学历";
    state.q = "";
    state.quick = null;
    state.sel.clear();
    state.exp.clear();
    state.sort = "due";
    state.dir = 1;
    const q = $("#q"); if (q) q.value = "";
    persistFilters();
    mountFilters();
    render();
    toast("筛选、排序与展开已重置");
  });

  /* KPI 卡就是入口：紧急卡只筛 7 天内截止，收藏卡只筛已收藏，单位卡跳单位库 */
  function hitKPI(e) {
    const card = e.target.closest ? e.target.closest(".kpi[role='button']") : null;
    if (!card) return;
    if (card.dataset.goview) { setView(card.dataset.goview); toast("已跳到单位库，按单位看岗位"); return; }
    const q = card.dataset.quick;
    state.quick = (q === "all" || q === state.quick) ? null : q;
    state.sel.clear();
    persistFilters();
    render();
    const k = KPIS();
    toast(state.quick === "urgent" ? `只显示 7 天内截止的 ${k.urgent7} 个岗位`
      : state.quick === "saved" ? `只显示你收藏的 ${state.saved.size} 个岗位`
      : "已回到全部在招岗位");
  }
  on(".kpis", "click", hitKPI);
  on(".kpis", "keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (!e.target.closest || !e.target.closest(".kpi[role='button']")) return;
    e.preventDefault();
    hitKPI(e);
  });
  $$("th.sortable").forEach(th => {
    on(th, "click", () => setSort(th.dataset.sort));
    on(th, "keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSort(th.dataset.sort); }
    });
  });

  /* 表格交互 */
  on("#rows", "click", e => {
    const ex = e.target.closest("[data-exp]");
    if (ex) {
      const i = Number(ex.dataset.exp);
      if (state.exp.has(i)) state.exp.delete(i); else state.exp.add(i);
      render();
      return;
    }
    const stg = e.target.closest("[data-stage]");
    if (stg) { setStage(Number(stg.dataset.stage), stg.dataset.st); return; }
    const cp = e.target.closest("[data-copy]");
    if (cp) {
      const d = byId.get(Number(cp.dataset.copy));
      if (!d) return;
      copyAndToast(copyTarget(d), "已复制报名入口", "复制失败：请手动选中「报名入口」再复制");
      return;
    }
    const star = e.target.closest("[data-save]");
    if (star) {
      const i = Number(star.dataset.save);
      const next = setSaved(i, !state.saved.has(i));
      toast(next ? "已加入投递清单" : "已取消收藏");
      return;
    }
    const open = e.target.closest("[data-open]");
    if (open) { openDrawer(Number(open.dataset.open), open); return; }
    const cb = e.target.closest("input[type=checkbox]");
    if (cb) {
      const i = Number(cb.closest("tr").dataset.i);
      cb.checked ? state.sel.add(i) : state.sel.delete(i);
      syncBulk();
      return;
    }
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && String(sel).trim()) return;
    const tr = e.target.closest("tr[data-i]");
    if (tr) openDrawer(Number(tr.dataset.i), tr);
  });
  on("#checkAll", "change", e => {
    const list = filtered();
    if (e.target.checked) list.forEach(d => state.sel.add(d.i));
    else list.forEach(d => state.sel.delete(d.i));
    e.target.indeterminate = false;
    paintRows(list);
    syncBulk(list);
  });
  on("#clearSel", "click", () => { state.sel.clear(); paintRows(filtered()); syncBulk(); });
  on("#saveSel", "click", () => {
    const list = visibleSelected();
    if (!list.length) { toast("先勾选要收藏的岗位"); return; }
    setSavedMany(list, true);
    state.sel.clear();
    paintRows(filtered());
    syncBulk();
    toast(`已收藏 ${list.length} 条岗位`);
  });
  on("#copySel", "click", () => {
    const list = visibleSelected();
    if (!list.length) { toast("先勾选要复制的岗位"); return; }
    const text = list.map(d => `${d.u || ""} ${d.r || ""}\t${copyTarget(d)}`).join("\n");
    copyAndToast(text, `已复制 ${list.length} 条报名入口`, "复制失败：请检查浏览器剪贴板权限");
  });
  on("#exportBtn", "click", exportCsv);

  /* 视图导航 */
  $$(".navi a").forEach(a => on(a, "click", e => {
    e.preventDefault();
    if (a.dataset.view) setView(a.dataset.view);
  }));
  on("#newBtn", "click", () => {
    setView("collect");
    const inp = $("#curl");
    if (inp) setTimeout(() => { inp.focus(); inp.select(); }, 0);
  });
  on("#themeBtn", "click", () => {
    const dark = document.documentElement.dataset.theme === "dark";
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    const b = $("#themeBtn");
    if (b) b.setAttribute("aria-pressed", String(next === "dark"));
    lsSet(LS.theme, next);
  });
  on(".density", "click", e => {
    const b = e.target.closest(".dbtn");
    if (b) setDensity(b.dataset.den);
  });
  on("#fsMinus", "click", () => {
    const i = FS_STEPS.indexOf(nearestFs());
    applyFs(FS_STEPS[Math.max(0, i - 1)]);
  });
  on("#fsPlus", "click", () => {
    const i = FS_STEPS.indexOf(nearestFs());
    applyFs(FS_STEPS[Math.min(FS_STEPS.length - 1, i + 1)]);
  });

  on("#bellBtn", "click", () => toast("示例数据：暂无新通知"));

  /* 单位库 / 我的投递 */
  on("#unitchips", "click", e => {
    const b = e.target.closest(".chip");
    if (!b) return;
    state.uType = b.dataset.utype;
    renderUnits();
  });
  on("#urows", "click", e => {
    const row = e.target.closest("[data-unit]");
    if (row) gotoUnit(row.dataset.unit);
  });
  on("#mrows", "click", e => {
    const adv = e.target.closest("[data-adv]");
    if (adv) {
      const i = Number(adv.dataset.adv);
      const cur = stageOf(i).n;
      setStage(i, STAGES[(cur + 1) % STAGES.length].k);
      return;
    }
    const star = e.target.closest("[data-save]");
    if (star) {
      const i = Number(star.dataset.save);
      // setSaved 内部已同步 KPI 并在 mine 视图重绘，这里不再重复 render
      const next = setSaved(i, !state.saved.has(i));
      toast(next ? "已加入投递清单" : "已从投递清单移除");
      return;
    }
    const cb = e.target.closest("[data-check]");
    if (cb) {
      const i = Number(cb.dataset.check);
      if (cb.checked) state.sel.add(i); else state.sel.delete(i);
      const row = cb.closest(".row");
      if (row) row.classList.toggle("selected", cb.checked);
      return;
    }
    const open = e.target.closest("[data-open]");
    if (open) { openDrawer(Number(open.dataset.open), open); return; }
    const row = e.target.closest(".row[data-i]");
    if (row) openDrawer(Number(row.dataset.i), row);
  });
  on("#mineExport", "click", exportMine);
  /* 漏斗：点一次筛这一档，再点一次取消 */
  on("#mfunnel", "click", e => {
    const b = e.target.closest("[data-mst]");
    if (!b) return;
    const k = b.dataset.mst;
    state.mineSt = (state.mineSt === k) ? null : k;
    renderMine();
    syncStatusText();
    const n = state.mineSt ? savedJobs().filter(d => stageOf(d.i).k === state.mineSt).length : savedJobs().length;
    toast(state.mineSt ? `只看「${STAGE_I[k].lb}」：${n} 条` : "已回到全部");
  });

  /* 抽屉 */
  on("#dwClose", "click", closeDrawer);
  on("#scrim", "click", closeDrawer);
  on("#dwStages", "click", e => {
    const b = e.target.closest("[data-stage]");
    if (b) setStage(Number(b.dataset.stage), b.dataset.st);
  });
  on("#dwSave", "click", () => {
    if (dwIndex == null) return;
    const next = setSaved(dwIndex, !state.saved.has(dwIndex));
    toast(next ? "已加入投递清单" : "已取消收藏");
  });
  on("#dwGo", "click", () => { if (dwIndex != null) openJobUrl(byId.get(dwIndex)); });

  /* 公告采集 */
  on("#crawlBtn", "click", () => { const inp = $("#curl"); startCrawl(inp ? inp.value : ""); });
  on("#curl", "keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); startCrawl(e.target.value); }
  });
  on("#cq", "input", e => { cq = e.target.value.trim(); renderCitems(); });

  /* ---- 公告列表 type-ahead：聚焦列表里直接敲字，跳到最近的标题/单位 ---- */
  let taBuf = "", taTimer = 0;
  function taFocus() {
    const items = $$("#citems .citem");
    if (!items.length) return null;
    let best = null, bestIdx = -1;
    const seq = taBuf.toLowerCase();
    items.forEach((b, i) => {
      const n = NOTICES.filter(x => String(x.id) === b.dataset.n)[0];
      if (!n) return;
      const hay = `${n.u || ""} ${n.title || ""}`.toLowerCase();
      if (hay.indexOf(seq) >= 0 && bestIdx < 0) { best = n; bestIdx = i; }
    });
    if (!best) return null;
    curNotice = best.id;
    renderCitems();
    renderCinfo();
    syncCountText(filtered());
    const sel = document.querySelector(`#citems .citem[data-n="${best.id}"]`);
    if (sel && sel.focus) sel.focus({ preventScroll: false });
    /* 状态栏闪一下「跳到：标题」，比在列表里塞提示条干净 */
    setText("#statusCount", "跳到：" + (best.title || ""));
    clearTimeout(window.__taStatusT);
    window.__taStatusT = setTimeout(() => {
      const sr = skillRows(state.skillType === "全部" ? DATA : DATA.filter(d => d && d.t === state.skillType));
      if (state.view === "collect") setText("#statusCount", `采集 ${NOTICES.length} 条公告`);
      else if (state.view === "skill") setText("#statusCount", `技能口径 ${sr.rows.length} 项 · 样本 ${sr.sample} 条`);
      else syncCountText(filtered());
    }, 1500);
    return best;
  }
  on("#citems", "keydown", e => {
    const printable = e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing;
    if (printable) {
      taBuf += e.key;
      clearTimeout(taTimer);
      taTimer = setTimeout(() => { taBuf = ""; }, 800);
      const hit = taFocus();
      if (hit) { e.preventDefault(); return; }
      if (taBuf.length > 1) { e.preventDefault(); return; }
    }
    if (e.key === "Escape") { taBuf = ""; return; }
  });

  on("#citems", "click", e => {
    const b = e.target.closest(".citem");
    if (!b) return;
    curNotice = b.dataset.n;
    renderCitems();
    renderCinfo();
    const sel = document.querySelector(`#citems .citem[data-n="${curNotice}"]`);
    if (sel) sel.focus({ preventScroll: true });
  });
  on("#citems", "keydown", e => {
    const items = $$("#citems .citem");
    if (!items.length) return;
    const active = document.activeElement.closest && document.activeElement.closest(".citem");
    const i = items.indexOf(active);
    let next = null;
    if (e.key === "ArrowDown") next = items[Math.min(i + 1, items.length - 1)];
    else if (e.key === "ArrowUp") next = items[Math.max(i - 1, 0)];
    else if (e.key === "Home") next = items[0];
    else if (e.key === "End") next = items[items.length - 1];
    if (next) { e.preventDefault(); next.focus(); }
  });
  on("#cinfo", "click", e => {
    const jum = e.target.closest("[data-n]");
    if (jum) { curNotice = jum.dataset.n; renderCitems(); renderCinfo(); return; }
    const fold = e.target.closest("[data-fold]");
    if (fold) {
      exOpen = !exOpen;
      const wrap = document.querySelector("#cinfo .exwrap");
      if (wrap) wrap.hidden = !exOpen;
      fold.setAttribute("aria-expanded", String(exOpen));
      return;
    }
    const open = e.target.closest("[data-open]");
    if (open) { openDrawer(Number(open.dataset.open), open); return; }
    const n = currentNotice();
    if (!n) return;
    if (e.target.closest("#reparse")) {
      if (stOf(n) === "parsing" || stOf(n) === "pending") return;
      runParse(n);
      toast(stOf(n) === "ok" ? "重新解析中…" : "重试中…");
    } else if (e.target.closest("#expNotice")) {
      exportNoticeCsv(n);
    } else if (e.target.closest("#openSrc")) {
      const url = noticeUrl(n);
      if (!url) { toast("这条公告还没有可打开的原文地址"); return; }
      window.open(url, "_blank", "noopener");
    }
  });

  /* 快捷键 */
  document.addEventListener("keydown", e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      const q = $("#q");
      if (q) { q.focus(); q.select(); }
    }
    if (e.key === "Tab") {
      const drawer = $("#drawer");
      if (drawer && drawer.classList.contains("on")) {
        const focusables = [...drawer.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
          .filter(el => el.getClientRects().length > 0);
        if (focusables.length) {
          const first = focusables[0], last = focusables[focusables.length - 1];
          if (!drawer.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
          return;
        }
      }
    }
    if (e.key === "Escape") closeDrawer();
  });
}

/* ---------------- 密度 / 主题 ---------------- */
function setDensity(v) {
  const val = v === "tight" ? "tight" : "loose";
  document.documentElement.dataset.density = val;
  $$(".dbtn").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.den === val)));
  lsSet(LS.density, val);
}
function applyTheme() {
  const param = /[?&]theme=dark/.test(location.search) ? "dark" : "";
  const saved = lsGet(LS.theme, "");
  const theme = param || (saved === "dark" ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
  const b = $("#themeBtn");
  if (b) b.setAttribute("aria-pressed", String(theme === "dark"));
}

/* ---------------- 字号（15 / 17 / 19 / 21 px） ---------------- */
const FS_STEPS = [15, 17, 19, 21];
function nearestFs() {
  const raw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--fs"));
  const v = Number.isFinite(raw) && raw > 0 ? raw : 17;
  return FS_STEPS.reduce((best, s) => Math.abs(s - v) < Math.abs(best - v) ? s : best, FS_STEPS[1]);
}
function applyFs(v, quiet) {
  const px = FS_STEPS.indexOf(v) >= 0 ? v : FS_STEPS[1];
  document.documentElement.style.setProperty("--fs", px + "px");
  lsSet(LS.fs, px + "px");
  const m = $("#fsMinus"), p = $("#fsPlus");
  if (m) m.disabled = px <= FS_STEPS[0];
  if (p) p.disabled = px >= FS_STEPS[FS_STEPS.length - 1];
  if (!quiet) toast("字号 " + px + "px");
}
function initA11y() {
  const el = $("#toast");
  if (el) { el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite"); el.setAttribute("aria-atomic", "true"); }
  const drawer = $("#drawer");
  if (drawer) {
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-modal", "true");
    drawer.setAttribute("aria-labelledby", "dwRole");
    if (drawer.getAttribute("aria-hidden") === "true") drawer.inert = true;
  }
  const save = $("#dwSave");
  if (save) save.setAttribute("aria-pressed", "false");
  // 单位库 / 我的投递的 div 表格已由 HTML 带 .u / .m 修饰类，列宽交给 ui，这里不再叠类
}

/* ---------------- 启动 ---------------- */
(function init() {
  applyTheme();
  setDensity(lsGet(LS.density, "loose"));
  const savedFs = parseFloat(lsGet(LS.fs, ""));
  applyFs(Number.isFinite(savedFs) ? FS_STEPS.reduce((b, s) => Math.abs(s - savedFs) < Math.abs(b - savedFs) ? s : b, FS_STEPS[1]) : 17, true);

  restoreSaved();
  restoreFilters();
  mountTypebar();
  reindex();
  syncFiltersUI();
  const q = $("#q");
  if (q) q.value = state.q;
  initA11y();

  render();
  renderCitems();
  renderCinfo();
  setView(viewFromUrl(), { silent: true });
  bindEvents();
})();
