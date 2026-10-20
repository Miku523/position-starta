/* ======================================================================
   星他（STARTA）招聘工作台 · assets/app.js
   渲染与交互层：市场岗位库 / 情报采集 / 竞争雇主 / 对标清单 / 门槛基准。
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
/* 个人中心（assets/me.js）在 app.js 之后才加载，这里留一个安全取值口 */
function meCount() {
  try { const m = window.ME; return m && typeof m.count === "function" ? Number(m.count()) || 0 : 0; }
  catch (e) { return 0; }
}

const LS = {
  theme: "starta-wb-theme",
  density: "starta-wb-density",
  fs: "starta-wb-fs",
  /* 对标集：早期版本存过候选人时期的收藏，按新口径另起一个键，不迁移 */
  saved: "starta-wb-bench",
  filters: "starta-wb-filters"
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
  const raw = String(dstr == null ? "" : dstr).trim();
  /* 真实数据带完整 ISO 日期（YYYY-MM-DD）：直接按绝对日期算，不能落到「最近年份」，
     否则 2026-02-06 这种已截止的日期会被推到 2027 年，显示成 +109 天。 */
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) {
    const t = new Date(+iso[1], +iso[2] - 1, +iso[3]);
    if (!isNaN(t.getTime())) return Math.round((t - TODAY_DATE) / 86400000);
  }
  if (typeof S.daysLeft === "function") {
    try { const v = S.daysLeft(dstr); if (typeof v === "number" && isFinite(v)) return v; } catch (e) { /* 走本地兜底 */ }
  }
  const m = /(\d{1,2})-(\d{1,2})/.exec(raw);
  if (!m) return null;
  // 用最近年份解析：跨年时自动落到去年 / 明年
  let t = new Date(TODAY_DATE.getFullYear(), +m[1] - 1, +m[2]);
  let diff = Math.round((t - TODAY_DATE) / 86400000);
  if (diff < -180) { t = new Date(TODAY_DATE.getFullYear() + 1, +m[1] - 1, +m[2]); diff = Math.round((t - TODAY_DATE) / 86400000); }
  else if (diff > 180) { t = new Date(TODAY_DATE.getFullYear() - 1, +m[1] - 1, +m[2]); diff = Math.round((t - TODAY_DATE) / 86400000); }
  return diff;
}
/* 一条岗位的「还剩几天」：优先用真实截止日 end（ISO），退回展示用的 MM-DD */
function dleft(d) {
  if (!d) return null;
  if (d.left != null && isFinite(d.left)) return Number(d.left);
  return daysLeft(d.end || d.d);
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
  const la = dleft(a), lb = dleft(b);
  if (la === null || lb === null) {
    if (la === null && lb === null) return 0;
    return la === null ? 1 : -1;
  }
  return la - lb;
}
/* 接受岗位对象或 MM-DD 字符串：7 天内关窗且还开着 */
function isSoon(x) {
  const left = (x && typeof x === "object") ? dleft(x) : daysLeft(x);
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
  quick: null, /* null | "urgent" | "open" | "saved"：点 KPI 卡进来的快捷筛选 */
  prog: {}, /* i -> { st, at }：研判阶段 + 最后一次改动日期 */
  mineSt: null, /* 对标清单页的阶段筛选 */
  mPage: 0, /* 对标清单当前页（0 起） */
  page: 0, /* 市场岗位库当前页（0 起） */
  pgSize: 50, /* 一页 50 条：9,200 行不可能一次画完 */
  uPage: 0, /* 竞争雇主当前页 */
  uQ: "", /* 竞争雇主搜索词 */
  noticeFilter: null /* 从情报采集点「看全部岗位」带过来的公告 id */
};

/* ---------------- 研判阶段 ----------------
   对标 ≠ 收藏。进对标集的岗位都带一个阶段，和「最后一次动它」的日期。
   键名沿用 saved/applied/written/interview/result：CSS 配色、漏斗 data-mst、旧本地数据都挂在这上面，只换对外口径。 */
const STAGES = [
  { k: "saved",     lb: "待研判",   hint: "收进来了，还没拆口径",     color: "muted" },
  { k: "applied",   lb: "已对标",   hint: "要求 / 名额 / 窗口已核对", color: "#2C5D9E" },
  { k: "written",   lb: "已进简报", hint: "已写进周报或情况简报",     color: "#6B4FA8" },
  { k: "interview", lb: "已汇报",   hint: "已上会或给老板过目",       color: "warn" },
  { k: "result",    lb: "已落地",   hint: "JD 已定 / 招聘已启动",     color: "ok" }
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
      if (f.quick === null || f.quick === "urgent" || f.quick === "open" || f.quick === "saved") state.quick = f.quick;
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
/* KPI 只与静态 DATA / S.META 有关：整页只算一次（原来 syncCountText 与 syncKPI 各调一次，
   每次都把 9,200 行扫两遍 = daysLeft 36,801 次/渲染）。 */
let __kpiCache = null;
function KPIS() {
  if (__kpiCache) return __kpiCache;
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
        __kpiCache = out;
        return out;
      }
    } catch (e) { /* 兜底 */ }
  }
  __kpiCache = base;
  return base;
}

/* ---------------- 筛选 / 排序 ---------------- */
/* 行级小写 haystack：12 个字段每行只拼一次，之后直接 indexOf。
   9,200 行约 3MB 字符串，换掉每次按键 9,200 次模板拼接 + toLowerCase。 */
let __hayRows = [];
function hayOf(i, d) {
  const hit = __hayRows[i];
  if (typeof hit === "string") return hit;
  const hay = `${d.u || ""} ${d.r || ""} ${d.m || ""} ${d.mf || ""} ${d.t || ""} ${d.city || ""} ${d.w || ""} ${d.code || ""} ${d.dept || ""} ${d.lv || ""} ${d.cand || ""} ${d.desc || ""}`.toLowerCase();
  __hayRows[i] = hay;
  return hay;
}
/* 同一筛选条件下 filtered() 只算一次：翻页/展开/勾选/主题/密度都会走 render()，
   但这些操作不改变结果集，没必要把 9,200 行重扫 + 全量重排。
   键 = filterSig()（函数声明提升到顶部可用）+ 对标集内容（quick==="saved" 时才参与）。 */
let __filteredCache = { sig: null, list: null };
/* 单一 Intl.Collator 实例：String.localeCompare(x, "zh") 每次调用都要构造/查表，
   9,200 行排序约 12 万次比较；共享实例后排序快一个数量级。 */
let __zhColl = null;
function zhColl() { return __zhColl || (__zhColl = new Intl.Collator("zh")); }
function filtered() {
  const sig = filterSig() + "\u0002" + (state.quick === "saved" ? Array.from(state.saved).sort((a, b) => a - b).join(",") : "");
  if (__filteredCache.sig === sig) return __filteredCache.list;
  const q = state.q.toLowerCase();
  const list = [];
  DATA.forEach((d, i) => {
    if (!d) return;
    if (state.type !== "全部" && d.t !== state.type) return;
    if (state.noticeFilter && d.src !== state.noticeFilter) return;
    if (state.quick === "urgent" && !isSoon(d)) return;
    if (state.quick === "open" && !d.open) return;
    if (state.quick === "saved" && !state.saved.has(i)) return;
    /* 专业门类是多值字段（用 | 分隔），按 token 包含匹配，避免「只选一个门类就漏掉复合专业」 */
    if (state.major !== "全部专业" && String(d.mf || "").indexOf(state.major) < 0) return;
    if (state.edu !== "全部学历" && d.e !== state.edu) return;
    if (q && hayOf(i, d).indexOf(q) < 0) return;
    list.push(Object.assign({}, d, { i }));
  });
  const key = state.sort;
  const dir = state.dir < 0 ? -1 : 1;
  if (key === "n") {
    list.sort((a, b) => ((Number(a.n) || 0) - (Number(b.n) || 0)) * dir);
  } else if (key === "unit") {
    const coll = zhColl();
    list.sort((a, b) => {
      const u = coll.compare(String(a.u || ""), String(b.u || ""));
      return u ? u * dir : dueCompare(a, b);
    });
  } else {
    /* 排序键先算一遍：dleft 内含正则 + Date 构造，旧实现每次比较跑 2 次
       （9,200 行 ≈ 24 万次），预算成 Map 后排序只比数字，顺序完全等价。 */
    const left = new Map();
    list.forEach(d => left.set(d.i, dleft(d)));
    list.sort((a, b) => {
      const la = left.get(a.i), lb = left.get(b.i);
      const dv = (la === null || lb === null)
        ? (la === null && lb === null ? 0 : (la === null ? 1 : -1))
        : la - lb;
      return dv ? dv * dir : (Number(b.n) || 0) - (Number(a.n) || 0);
    });
  }
  __filteredCache = { sig, list };
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
  const left = dleft(d);
  if (left === null) return `<td class="c-due" title="长期开放">${esc(d.d)}<small>长期</small></td>`;
  if (left < 0) return `<td class="c-due expired" title="已过截止日 ${esc(d.end || d.d)}">${esc(d.d)}<small>已截止</small></td>`;
  const open = !!d.open;
  const soon = left <= 7;
  const label = left === 0 ? "今天" : left + " 天";
  const tip = left === 0 ? "今天截止，别拖" : left <= 7 ? `距截止 ${left} 天，先处理` : `距截止 ${left} 天`;
  return `<td class="c-due${soon ? " soon" : ""}${open ? "" : " closed"}" title="${tip}">${esc(d.d)}<small>${label}</small></td>`;
}
function rowHtml(d) {
  const open = state.exp.has(d.i);
  const saved = state.saved.has(d.i);
  let applied = false;
  try { applied = !!(window.ME && typeof window.ME.has === "function" && window.ME.has(d.i)); } catch (e) { applied = false; }
  const main = `<tr data-i="${d.i}" tabindex="-1" class="${state.sel.has(d.i) ? "selected" : ""}${open ? " opened" : ""}">
    <td><input type="checkbox" ${state.sel.has(d.i) ? "checked" : ""} aria-label="选择 ${esc(d.u)} ${esc(d.r)}"></td>
    <td class="c-unit" title="${esc(d.u)}${d.city ? " · " + esc(d.city) : ""}"><span class="u-name">${esc(d.u)}</span><small class="u-meta"><span>${esc(d.city || "—")}</span>${state.saved.has(d.i) ? stageChip(d.i) : ""}</small></td>
    <td class="c-role">${esc(d.r)}${d.code ? `<small class="role-code">${esc(d.code)}</small>` : ""}${d.open ? `<small class="role-open">报名中</small>` : ""}</td>
    <td><span class="tag" data-t="${esc(d.t)}">${esc(d.t)}</span></td>
    <td class="c-major">${esc(d.m)}</td>
    <td class="c-dim c-edu">${esc(d.e)} · ${esc(d.x)}</td>
    <td class="c-num">${d.n} 人</td>
    ${dueCell(d)}
    <td class="c-op"><button class="go star" data-save="${d.i}" data-name="${esc(d.r)}" aria-pressed="${saved}" aria-label="${saved ? "移出对标集" : "对标"} ${esc(d.r)}">${saved ? "★" : "☆"}</button><button class="go applybtn${applied ? " done" : ""}" data-apply="${d.i}" aria-label="${applied ? "已投递" : "投递"} ${esc(d.u)} ${esc(d.r)}" title="${applied ? "已投递，去个人中心看进度" : "投递这个岗位"}">${applied ? "已投递" : "投递"}</button><button class="expbtn" data-exp="${d.i}" aria-expanded="${open}" aria-label="展开 ${esc(d.r)} 的要求" title="展开要求"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button><button class="go" data-open="${d.i}">详情</button></td>
  </tr>`;
  return open ? main + expandRow(d) : main;
}
function expandRow(d) {
  const left = dleft(d);
  const win = left === null ? "长期开放，随到随投" : left < 0 ? "已截止" : left === 0 ? "今天截止" : `剩 ${left} 天`;
  const n = NOTICES.filter(x => x.id === d.src)[0];
  return `<tr class="exp"><td colspan="9"><div class="exp-in">
    <div>
      <div class="exp-desc">${esc(d.desc)}</div>
      <div class="exp-actions">
        <button class="btn ghost" data-apply="${d.i}">投递这个岗位</button>
        <button class="btn ghost" data-save="${d.i}">${state.saved.has(d.i) ? "★ 已对标" : "☆ 对标"}</button>
        <button class="btn ghost" data-copy="${d.i}">复制报名渠道</button>
        <button class="btn ghost" data-open="${d.i}">看完整详情</button>
      </div>
      <div class="stchips" role="group" aria-label="设置 ${esc(d.r)} 的研判阶段">
        ${STAGES.map(s => `<button class="stchip" data-stage="${d.i}" data-st="${s.k}" aria-pressed="${stageOf(d.i).k === s.k}" title="${esc(s.hint)}">${esc(s.lb)}</button>`).join("")}
        <span class="st-at">${state.saved.has(d.i) ? "上次更新 " + esc((state.prog[d.i] || {}).at || "—") : "选一个阶段即加入对标清单"}</span>
      </div>
    </div>
    <div class="exp-side">
      <div><div class="k">岗位代码</div><b>${esc(d.code || "—")}</b></div>
      <div><div class="k">部门 / 等级</div>${esc(d.dept || "—")} · ${esc(d.lv || "—")}</div>
      <div><div class="k">报名渠道</div><b>${esc(d.w)}</b></div>
      <div><div class="k">报名窗口</div><b>${win}</b><span style="color:var(--muted);font-size:.78rem"> · 截止 ${esc(d.end || d.d)}</span></div>
      <div><div class="k">门槛</div>${esc(d.e)} · ${esc(d.x)} · 学位 ${esc(d.deg || "不限")} · 招 ${d.n} 人</div>
      <div><div class="k">来源公告</div>${n ? `<a class="${lnkCls(noticeUrl(n))}" href="${esc(noticeUrl(n))}" target="_blank" rel="noopener"${deadTitle(noticeUrl(n)) ? ` title="${esc(deadTitle(noticeUrl(n)))}"` : ""}>${esc(n.title)}</a>${lnkDeadTag(noticeUrl(n))}` : "—"}</div>
    </div>
  </div></td></tr>`;
}
function emptyJobsHtml() {
  if (state.quick === "saved") return `<b>对标集还是空的</b>在列表里点一下 ☆，一条岗位就进了待研判；或者点「全库岗位」卡回到全量。`;
  if (state.quick === "open") return `<b>眼下没有正在报名的岗位</b>两份公告里只有大兴安岭那批还开着；点「全库岗位」卡回到全量看历史岗位。`;
  if (state.quick === "urgent") return `<b>眼下没有 7 天内关窗的岗位</b>点「全库岗位」卡回到全量，或者按关窗时间排一遍。`;
  if (state.noticeFilter) return `<b>这份公告下没有符合条件的岗位</b>点「重置」清掉关键词与筛选再试。`;
  return `<b>没有匹配的岗位</b>换个雇主性质、专业门类或学历，或清空关键词、点「重置」再试。`;
}
function paintRows(list) {
  const rows = $("#rows");
  if (!rows) return;
  rows.innerHTML = list.length
    ? list.map(rowHtml).join("")
    : `<tr><td colspan="9"><div class="empty">${emptyJobsHtml()}</div></td></tr>`;
}
/* ---------------- 分页：9,200 行一次画不完，只画当页 ---------------- */
function pageCount(list) {
  return Math.max(1, Math.ceil(((list || []).length) / state.pgSize));
}
function pageSlice(list) {
  const all = list || [];
  const pages = pageCount(all);
  if (state.page > pages - 1) state.page = pages - 1;
  if (state.page < 0) state.page = 0;
  const from = state.page * state.pgSize;
  return { slice: all.slice(from, from + state.pgSize), from, total: all.length, pages, page: state.page };
}
/* 页码窗口：当前页两侧各 2 页，首尾固定带省略号 */
function pageWindow(cur, pages, attr) {
  const key = attr || "page";
  const out = [];
  const push = v => { if (out[out.length - 1] !== v) out.push(v); };
  push(0);
  for (let p = Math.max(1, cur - 2); p <= Math.min(pages - 2, cur + 2); p++) push(p);
  push(pages - 1);
  const html = [];
  out.forEach((p, idx) => {
    if (idx && p - out[idx - 1] > 1) html.push(`<span class="pg-gap">…</span>`);
    html.push(`<button class="pg-btn${p === cur ? " on" : ""}" data-${key}="${p}" aria-label="第 ${p + 1} 页" aria-current="${p === cur ? "page" : "false"}">${p + 1}</button>`);
  });
  return html.join("");
}
function syncPager(list) {
  const box = $("#pager");
  if (!box) return;
  const s = pageSlice(list);
  if (!s.total) { box.innerHTML = `<span class="pg-meta">共 0 条</span>`; return; }
  const first = (s.from + 1).toLocaleString("zh-CN");
  const last = Math.min(s.from + state.pgSize, s.total).toLocaleString("zh-CN");
  box.innerHTML = `<span class="pg-meta">${first}–${last} / 共 ${s.total.toLocaleString("zh-CN")} 条</span>
    <div class="pg-nums">
      <button class="pg-btn pg-prev" data-page="${s.pages > 1 ? s.page - 1 : 0}" ${s.page === 0 ? "disabled" : ""} aria-label="上一页">‹</button>
      ${pageWindow(s.page, s.pages)}
      <button class="pg-btn pg-next" data-page="${s.page + 1}" ${s.page >= s.pages - 1 ? "disabled" : ""} aria-label="下一页">›</button>
    </div>
    <span class="pg-meta">第 ${s.page + 1} / ${s.pages} 页 · 每页 ${state.pgSize}</span>`;
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
  const vis = list || filtered(); /* 当页 */
  const ids = vis.map(d => d.i);
  const nSel = state.sel.size; /* 已选可能跨页，计数用全量 */
  const bar = $("#bulkbar");
  if (bar) bar.classList.toggle("on", nSel > 0);
  setText("#bulkNum", nSel.toLocaleString("zh-CN"));
  const all = $("#checkAll");
  if (all) {
    const onPage = ids.filter(i => state.sel.has(i)).length;
    all.checked = ids.length > 0 && onPage === ids.length;
    all.indeterminate = onPage > 0 && onPage < ids.length;
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
  setText("#count", `${list.length.toLocaleString("zh-CN")} / ${total.toLocaleString("zh-CN")}`);
  /* 状态栏是「当前视图」的口径：市场岗位库才写「共 N 条 · 第 p/总 页」，
     其余视图由 syncStatusText() 负责，免得 render() 一跑就把别的视图文案冲掉 */
  if (state.view === "lib") {
    const pages = Math.max(1, Math.ceil(list.length / state.pgSize));
    setText("#statusCount", `共 ${list.length.toLocaleString("zh-CN")} 条 · 第 ${state.page + 1}/${pages} 页`);
  }
}
/* 对标清单：对标 N 条 · 已推进 M 条 */
function mineStatus() {
  let act = 0;
  state.saved.forEach(i => { if (stageOf(i).k !== "saved") act++; });
  return state.saved.size
    ? `对标 ${state.saved.size.toLocaleString("zh-CN")} 条 · 已推进 ${act.toLocaleString("zh-CN")} 条`
    : "对标 0 条";
}
/* 按当前视图刷新状态栏（视图切换、阶段推进、漏斗筛选后都调它） */
function syncStatusText() {
  const v = state.view;
  if (v === "lib") {
    const list = filtered();
    const pages = Math.max(1, Math.ceil(list.length / state.pgSize));
    setText("#statusCount", `共 ${list.length.toLocaleString("zh-CN")} 条 · 第 ${state.page + 1}/${pages} 页`);
  }
  else if (v === "collect") setText("#statusCount", `采集 ${NOTICES.length} 条公告`);
  else if (v === "units") setText("#statusCount", `聚合 ${typeof S.unitsOf === "function" ? (S.unitsOf() || []).length.toLocaleString("zh-CN") : DATA.length} 家雇主`);
  else if (v === "mine") setText("#statusCount", mineStatus());
  else if (v === "me") setText("#statusCount", `投递 ${meCount().toLocaleString("zh-CN")} 条 · 资料${meScoreLabel()}`);
  else if (v === "skill") {
    const sr = skillRows(state.skillType === "全部" ? DATA : DATA.filter(d => d && d.t === state.skillType));
    setText("#statusCount", `门槛口径 ${sr.rows.length} 项 · 样本 ${sr.sample.toLocaleString("zh-CN")} 条`);
  }
}
function meScoreLabel() {
  try { const m = window.ME; return m && typeof m.score === "function" ? `完整度 ${m.score()}%` : "未填写"; }
  catch (e) { return "未填写"; }
}

/* ---------------- KPI / 徽标同步（只写 #kpiXxx 数字位，不重建卡片） ---------------- */
function earliestLabel() {
  const list = DATA.filter(d => d && d.open)
    .map(d => ({ d: d.d, left: dleft(d) }))
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
  const fmt = v => Number(v || 0).toLocaleString("zh-CN");
  setText("#kpiOpen", fmt(k.total));
  setText("#kpiWeekNew", NOTICES.length);
  setText("#kpiUnits", fmt(k.units));
  setText("#kpiTypes", uniq(DATA.map(d => d && d.t)).length);
  setText("#kpiUrgent", fmt(k.open));
  setText("#kpiEarliest", earliestLabel());
  setText("#kpiSaved", fmt(state.saved.size));

  // 已对标卡片的脚注跟随数量变化
  const savedNum = $("#kpiSaved");
  const savedCard = savedNum && savedNum.closest ? savedNum.closest(".kpi") : null;
  const savedFt = savedCard ? savedCard.querySelector(".ft") : null;
  if (savedFt) {
    const cnt = {};
    STAGES.forEach(s => { cnt[s.k] = 0; });
    state.saved.forEach(i => { cnt[stageOf(i).k]++; });
    const parts = STAGES.filter(s => s.k !== "saved" && cnt[s.k]).map(s => `${s.lb} ${cnt[s.k]}`);
    savedFt.innerHTML = `<span class="dot"></span>${state.saved.size
      ? (parts.length ? parts.join(" · ") : `待研判 ${cnt.saved}`)
      : "点星标即对标"}`;
    savedFt.title = state.saved.size ? "点此只看已对标的岗位" : "";
  }

  /* 卡片高亮 = 当前正被它筛着，点一下就知道自己在看什么 */
  $$(".kpi[data-quick]").forEach(card => {
    const on = card.dataset.quick === "all" ? state.quick === null : card.dataset.quick === state.quick;
    card.setAttribute("aria-pressed", String(on));
  });

  setText("#ctJobs", fmt(k.total));
  setText("#ctNotices", String(NOTICES.length));
  setText("#ctUnits", fmt(k.units));
  setText("#ctMine", fmt(state.saved.size));
  setText("#ctMe", String(meCount()));

  const sub = $("#view-lib .page-head .sub");
  if (sub) {
    const soonN = k.urgent7, savedN = state.saved.size;
    sub.innerHTML = `全库 <b>${fmt(k.total)}</b> 个岗位，来自 <b>${NOTICES.length} 份</b>真实公告的岗位表；`
      + `其中 <b>${fmt(k.open)}</b> 个正在报名${soonN ? `（<b>${soonN}</b> 个 7 天内关窗，最早 <b>${earliestLabel()}</b>）` : ""}，`
      + `其余是已截止的历史岗位，照样能拿来对标门槛。对标集里躺着 <b>${savedN}</b> 个。`;
  }
  const tags = $$("#view-lib .page-head .right .tag");
  if (tags[0]) tags[0].innerHTML = `数据源 ${NOTICES.length} 份公告`;
  if (tags[1]) tags[1].innerHTML = `<span class="dot"></span>真实岗位表 · ${esc(S.collectedAt || TODAY)} 采集`;
  setText("#statusMeta", `数据源 ${NOTICES.length} 份公告 · ${fmt(k.total)} 条真实岗位`);
  syncNoticeTag();
  paintBanner();
}

/* 顶部提示条：只在真有公告正在报名时出现，点「查看」跳情报采集 */
function paintBanner() {
  const box = $("#banner"), txt = $("#bannerText");
  if (!box || !txt) return;
  const live = NOTICES.filter(n => n.open);
  if (!live.length) { box.hidden = true; return; }
  const n = live[0];
  const left = n.end ? daysLeft(n.end) : null;
  txt.innerHTML = `<b>${esc(n.title.replace(/公告$/, ""))}</b> 正在报名：招 ${n.seats ? n.seats.toLocaleString("zh-CN") : "—"} 人，`
    + `${left !== null && left >= 0 ? `还有 <b>${left}</b> 天关窗（${esc(n.end)} 截止）` : `报名已于 ${esc(n.end)} 截止`}。`
    + ` <a class="lnk" href="?view=collect&notice=${encodeURIComponent(n.id)}" data-notice-jump="${esc(n.id)}">看公告原文与附件</a>`;
  box.hidden = false;
}

/* ---------------- 对标 / 研判阶段 ---------------- */
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
  b.textContent = saved ? "★ 已对标" : "☆ 对标";
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
      b.setAttribute("aria-label", (saved ? "移出对标集" : "对标") + (nm ? " " + nm : ""));
    } else {
      b.textContent = saved ? "★ 已对标" : "☆ 对标";
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
  toast(`${d ? d.r : "岗位"} → ${STAGE_I[st].lb}${had ? "" : "（已加入对标清单）"}`);
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
/* 公告 → 岗位 的归属：先按 id 精确对上，再退回旧口径（同单位） */
function noticeOf(d) {
  if (!d) return null;
  if (d.src) { const hit = NOTICES.filter(n => n.id === d.src)[0]; if (hit) return hit; }
  return NOTICES.filter(n => n.u === d.u)[0] || null;
}
/* 附件地址：/app/ 下要多退一级（部署时 data/ 在站点根），单文件版就地取 */
function attPrefix() {
  try { if (/(^|\/)app(\/|$)/.test(location.pathname)) return "../"; } catch (e) { /* 忽略 */ }
  return "";
}
function attUrl(local) {
  const v = String(local == null ? "" : local).trim();
  if (!v) return "";
  if (/^(https?:)?\/\//.test(v)) return v;
  return attPrefix() + v.replace(/^\.?\//, "");
}
/* ISO / ISO-like → 「2026-10-19 19:14」；认不出就原样返回 */
function fmtISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(s || ""));
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : String(s || "");
}
function fmtSize(n) {
  const v = Number(n || 0);
  if (!v) return "";
  if (v < 1024) return v + " B";
  if (v < 1048576) return (v / 1024).toFixed(0) + " KB";
  return (v / 1048576).toFixed(1) + " MB";
}
function jobUrl(d) {
  if (!d) return "";
  if (d.url) { const u = withScheme(d.url); if (u) return u; }
  if (d.w && /^https?:\/\//i.test(d.w)) return d.w;
  const n = noticeOf(d);
  return n ? noticeUrl(n) : "";
}
function copyTarget(d) {
  return jobUrl(d) || d.w || `${d.u || ""} ${d.r || ""}`.trim();
}

/* ---------------- 坏链标注 ----------------
   来源：_aux/d/logs/t0_baseline.json 实测外链 HTTP 状态（1 条 403、5 条 404）。
   只加类名与提示，不禁用链接：原站改版/下线后人工仍可能打开。
   .lnk.is-dead / .dead-tag 的样式由 ui 样板块提供，这里不写内联样式。 */
const DEAD_LINKS = [
  { p: "https://jshrss.jiangsu.gov.cn/col/col77207/index.html", code: 403 },
  { p: "https://hrss.shandong.gov.cn/col/col100176/index.html", code: 404 },
  { p: "https://rlsbt.zj.gov.cn/col/col1229506794/index.html", code: 404 },
  { p: "https://www.forestry.gov.cn/lyj/1/tzgg.html", code: 404 },
  { p: "https://hrss.gd.gov.cn/zwgk/xxgk/tzgg/index.html", code: 404 },
  { p: "https://www.forestry.gov.cn/lyj/1/gsgg/index.html", code: 404 }
];
function deadStatus(u) {
  const v = String(u == null ? "" : u).trim();
  if (!v) return 0;
  for (let i = 0; i < DEAD_LINKS.length; i++) {
    if (v.indexOf(DEAD_LINKS[i].p) === 0) return DEAD_LINKS[i].code;
  }
  return 0;
}
function deadTitle(u) {
  const code = deadStatus(u);
  if (!code) return "";
  return code === 403
    ? "原站拒绝自动访问（HTTP 403），仍可尝试打开"
    : "原站已改版或下线（HTTP 404），仍可尝试打开";
}
function lnkCls(u) { return deadStatus(u) ? "lnk is-dead" : "lnk"; }
function lnkDeadTag(u) { return deadStatus(u) ? ` <span class="dead-tag">失效</span>` : ""; }

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
    ["岗位代码", "单位", "地区", "岗位", "性质", "部门", "等级", "专业", "学历", "学位", "考生类别", "名额", "截止", "报名渠道", "来源公告"],
    list.map(d => {
      const nt = noticeOf(d);
      return [d.code, d.u, d.city, d.r, d.t, d.dept, d.lv, d.m, d.e, d.deg, d.cand, d.n, d.end || d.d, d.w, nt ? nt.title : ""];
    }),
    `starta-市场岗位-${list.length}条.csv`
  );
  toast(`已导出 ${n.toLocaleString("zh-CN")} 条市场岗位 CSV`);
}

/* ---------------- 抽屉 ---------------- */
let dwIndex = null;
let dwReturn = null;

function openDrawer(i, trigger, opts) {
  const d = byId.get(i);
  if (!d) return;
  dwIndex = i;
  dwReturn = trigger && trigger.focus ? trigger : document.activeElement;
  const n = noticeOf(d);
  setText("#dwRole", d.r);
  setText("#dwUnit", [d.u, d.city, d.code].filter(Boolean).join(" · "));
  setText("#dwType", d.t);
  const tag = $("#dwType");
  if (tag) tag.dataset.t = d.t || "";
  const kv = $("#dwKv");
  if (kv) kv.innerHTML = [
    ["专业", d.m || ((d.mf && d.mf !== "不限") ? d.mf.replace(/\//g, " / ") + "（门类）" : "不限")],
    ["学历 / 学位", `${d.e} / ${d.deg || "不限"}`], ["考生类别", d.cand || "不限"],
    ["名额", `${d.n} 人`], ["岗位代码", d.code || "—"], ["部门", d.dept || "—"],
    ["岗位等级", d.lv || "—"], ["报名截止", d.end || d.d], ["报名渠道", d.w],
    ["来源公告", n ? n.title : "—"]
  ].map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
  const srcLine = $("#dwSrcLine");
  if (srcLine) {
    srcLine.innerHTML = n
      ? `<a class="${lnkCls(noticeUrl(n))}" href="${esc(noticeUrl(n))}" target="_blank" rel="noopener"${deadTitle(noticeUrl(n)) ? ` title="${esc(deadTitle(noticeUrl(n)))}"` : ""}>${esc(n.title)}</a>${lnkDeadTag(noticeUrl(n))}
         <span class="muted">${esc(n.org || "")} · 发布 ${esc(n.published || "")} · ${esc(n.status || "")}</span>`
      : `<span class="muted">这条岗位来自岗位表汇总，未挂到可打开的公告原文。</span>`;
  }
  const atts = $("#dwAtts");
  if (atts) {
    const list = (n && n.attachments) || [];
    atts.innerHTML = list.length
      ? list.map(a => {
        const local = attUrl(a.local);
        const href = local || withScheme(a.url);
        if (!href) return "";
        return `<a class="att" href="${esc(href)}" target="_blank" rel="noopener"${local ? " download" : ""}><span class="att-fmt">${esc(a.fmt || "文件")}</span><span class="att-name">${esc(a.name)}</span>${a.size ? `<span class="att-size">${fmtSize(a.size)}</span>` : ""}</a>`;
      }).join("")
      : `<span class="muted">这份公告没有可下载的附件。</span>`;
  }
  setText("#dwDesc", d.desc);
  const left = dleft(d);
  const meter = $("#dwMeter");
  if (meter) {
    const span = n && n.applyStart && n.applyEnd
      ? Math.max(1, Math.round((new Date(n.applyEnd.replace(/-/g, "/")) - new Date(n.applyStart.replace(/-/g, "/"))) / 86400000))
      : 30;
    if (left === null) {
      meter.style.width = "100%"; meter.style.opacity = ".3";
      setText("#dwAxis", "长期开放，随到随投"); setText("#dwPct", "开放");
    } else if (left <= 0) {
      meter.style.width = "100%"; meter.style.opacity = ".3";
      setText("#dwAxis", "招聘窗口已关闭"); setText("#dwPct", "已截止");
    } else {
      meter.style.opacity = "1";
      meter.style.width = Math.max(6, Math.min(100, Math.round(left / span * 100))) + "%";
      setText("#dwAxis", `距截止日（报名期 ${span} 天）`); setText("#dwPct", `剩 ${left} 天`);
    }
  }
  paintDwSave();
  const apply = $("#dwApply");
  if (apply) {
    apply.dataset.i = String(i);
    let has = false;
    try { has = !!(window.ME && typeof window.ME.has === "function" && window.ME.has(i)); } catch (e) { has = false; }
    apply.textContent = has ? "已投递 · 去个人中心看" : "投递这个岗位";
    apply.classList.toggle("done", has);
    apply.disabled = left !== null && left < 0;
    apply.title = apply.disabled ? "该岗位报名已截止" : "";
  }
  const go = $("#dwGo");
  if (go) {
    go.textContent = n ? "打开公告原文" : (directJobUrl(d) ? "打开报名渠道" : "查看公告原文");
    go.disabled = !(n || directJobUrl(d));
  }
  const drawer = $("#drawer");
  const wasOpen = !!(drawer && drawer.classList.contains("on"));
  if (drawer) { drawer.inert = false; drawer.classList.add("on"); drawer.setAttribute("aria-hidden", "false"); }
  const scrim = $("#scrim");
  if (scrim) scrim.classList.add("on");
  const close = $("#dwClose");
  if (close) close.focus({ preventScroll: true });
  /* 抽屉参与浏览器历史：用户点开时单独压一条记录，返回键先关抽屉；
     boot 深链 / popstate 重放传 { history:false }，不重复压栈 */
  const viaHistory = !(opts && opts.history === false) && __urlReady;
  if (viaHistory) {
    if (wasOpen) syncUrlState("replace");
    else if (syncUrlState("push")) dwPushed = true;
  }
}
function closeDrawer(opts) {
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
  /* 历史收尾：用户点开的抽屉回退一条（popstate 负责把 URL 收干净）；
     boot 深链只 replace 去掉 job；popstate 重放传 history:false，URL 已对齐 */
  if (opts && opts.history === false) { dwPushed = false; return; }
  if (dwPushed) {
    dwPushed = false;
    try { history.back(); } catch (e) { syncUrlState("replace"); }
  } else {
    syncUrlState("replace");
  }
}
function openJobUrl(d) {
  const u = jobUrl(d);
  if (!u) { toast("这条岗位没有可打开的公告或报名渠道"); return; }
  window.open(u, "_blank", "noopener");
}

/* ---------------- 视图切换与 URL 状态 ----------------
   URL 是筛选状态的唯一真源：
   - 启动：URL 上出现的参数覆盖 localStorage，缺失时才用本地记忆（?q= 空串 = 显式清空）
   - 筛选 / 页码 / 排序 / 快捷筛选 / 公告：replaceState；视图切换：pushState 且只带 view（lib 省略）
   - 抽屉开着带 job；用户点开的抽屉单独压一条历史，返回键先关抽屉
   - file:// 或 history 不可用时全部跳过，页面照常工作 */
const VIEW_LABEL = { lib: "市场岗位库", collect: "情报采集", units: "竞争雇主", mine: "对标清单", skill: "门槛基准", me: "个人中心", jd: "我的职位", talent: "人才库", watch: "变化提醒", brief: "对标简报", settings: "设置与合规" };
const SORT_KEYS = ["due", "n", "unit", "role", "type"];
let __urlMute = false;    /* popstate 重放期间禁止回写，避免自己触发自己 */
let __urlReady = false;   /* bindEvents 完成后才允许回写 URL */
let __qRaf = 0;           /* 搜索输入防抖句柄：连续输入只在停顿后渲染一次 */
let dwPushed = false;     /* 当前抽屉是否压了一条历史（关闭时要 back 回去） */
let noticeLink = null;    /* URL 上显式携带的情报采集公告 id */

/* 标题：hr-core 在 HR 视图里会调 window.startaTitle(v)，这里对 11 个视图都给出唯一标题 */
function startaTitle(v) {
  document.title = (VIEW_LABEL[v] || VIEW_LABEL.lib) + " · 星他 招聘情报台";
  return document.title;
}
window.startaTitle = startaTitle;

/* 从地址栏读一份状态；null = 参数没出现（启动时保留 localStorage），空串语义只给 q */
function readUrlState() {
  const out = { view: null, q: null, pg: null, type: null, major: null, edu: null, sort: null, dir: null, quick: null, job: null, notice: null };
  let sp;
  try { sp = new URLSearchParams(location.search); } catch (e) { return out; }
  const get = k => sp.has(k) ? sp.get(k) : null;
  let v = get("view");
  if (!v) v = get("v");   /* ?v= 作为 view 别名，兼容旧分享链接 */
  if (v && VIEW_LABEL[v]) out.view = v;
  if (!out.view) {
    try {
      const m = /^#view-([a-z]+)$/.exec(location.hash || "");
      if (m && VIEW_LABEL[m[1]]) out.view = m[1];
    } catch (e) { /* 忽略 */ }
  }
  const rawQ = get("q");
  if (rawQ !== null) out.q = rawQ;
  if (get("pg") !== null) {
    const pg = Number(get("pg"));
    if (Number.isFinite(pg) && pg >= 1) out.pg = Math.floor(pg);
  }
  const t = get("type");
  if (t !== null) out.type = (t === "" || t === "全部") ? "全部" : (TYPES.indexOf(t) >= 0 ? t : null);
  const mj = get("major");
  if (mj !== null) out.major = (mj === "" || mj === "全部专业") ? "全部专业" : (majorOptions().indexOf(mj) >= 0 ? mj : null);
  const ed = get("edu");
  if (ed !== null) out.edu = (ed === "" || ed === "全部学历") ? "全部学历" : (eduOptions().indexOf(ed) >= 0 ? ed : null);
  const st = get("sort");
  if (st !== null) out.sort = SORT_KEYS.indexOf(st) >= 0 ? st : null;
  const dr = get("dir");
  if (dr !== null) out.dir = dr === "-1" ? -1 : (dr === "1" ? 1 : null);
  const qk = get("quick");
  if (qk !== null && qk !== "" && qk !== "all" && ["urgent", "open", "saved"].indexOf(qk) >= 0) out.quick = qk;
  const job = get("job");
  if (job !== null) {
    const j = Number(job);
    if (Number.isFinite(j) && byId.has(j)) out.job = j;
  }
  const nt = get("notice");
  if (nt && NOTICES.some(n => String(n.id) === nt)) out.notice = nt;
  return out;
}

/* 把 URL 状态写回 state：complete=true 时 URL 是完整真源（popstate 重放）；
   false 时只覆盖 URL 上实际出现的参数（启动时与 localStorage 合并） */
function applyUrlToState(us, complete) {
  if (!us) return;
  if (complete) {
    state.q = us.q === null ? "" : us.q;
    state.type = us.type === null ? "全部" : us.type;
    state.major = us.major === null ? "全部专业" : us.major;
    state.edu = us.edu === null ? "全部学历" : us.edu;
    state.sort = us.sort === null ? "due" : us.sort;
    state.dir = us.dir === null ? 1 : us.dir;
    state.quick = us.quick === null ? null : us.quick;
    state.page = us.pg === null ? 0 : Math.max(0, us.pg - 1);
    state.noticeFilter = null;
    return;
  }
  if (us.q !== null) state.q = us.q;
  if (us.type !== null) state.type = us.type;
  if (us.major !== null) state.major = us.major;
  if (us.edu !== null) state.edu = us.edu;
  if (us.sort !== null) state.sort = us.sort;
  if (us.dir !== null) state.dir = us.dir;
  if (us.quick !== null) state.quick = us.quick;
  if (us.pg !== null) state.page = Math.max(0, us.pg - 1);
}

/* 全量状态 → query 串（默认值省略：lib / 空 q / 第 1 页 / 全部筛选 / sort=due / dir=1） */
function buildUrlQuery() {
  const sp = new URLSearchParams();
  if (state.view !== "lib") sp.set("view", state.view);
  if (state.q) sp.set("q", state.q);
  if (state.page > 0) sp.set("pg", String(state.page + 1));
  if (state.type && state.type !== "全部") sp.set("type", state.type);
  if (state.major && state.major !== "全部专业") sp.set("major", state.major);
  if (state.edu && state.edu !== "全部学历") sp.set("edu", state.edu);
  if (state.sort && state.sort !== "due") sp.set("sort", state.sort);
  if (state.dir === -1) sp.set("dir", "-1");
  if (state.quick) sp.set("quick", state.quick);
  if (dwIndex != null) sp.set("job", String(dwIndex));
  /* 情报采集的 notice 表示「正在看的公告」；市场岗位库的 notice 表示「公告筛选」，
     后者要显式带 view=lib，否则会被误解成采集视图的深链 */
  const noticeId = state.view === "collect"
    ? (noticeLink && NOTICES.some(n => String(n.id) === String(noticeLink)) ? noticeLink : null)
    : (state.noticeFilter && NOTICES.some(n => String(n.id) === String(state.noticeFilter)) ? state.noticeFilter : null);
  if (noticeId) {
    if (state.view === "lib") sp.set("view", "lib");
    sp.set("notice", noticeId);
  }
  return sp.toString();
}

/* 写地址栏：onlyView=true 用于视图切换（只保留 view；抽屉开着补 job）
   返回写入后的完整地址，没写则返回 ""（file:// / 静音 / 地址没变） */
function syncUrlState(mode, opts) {
  if (__urlMute || !__urlReady) return "";
  try { if (location.protocol === "file:") return ""; } catch (e) { return ""; }
  if (!window.history || typeof history.pushState !== "function") return "";
  const onlyView = !!(opts && opts.onlyView);
  let url;
  try { url = new URL(location.href); } catch (e) { return ""; }
  let qs;
  if (onlyView) {
    if (state.view === "lib") {
      /* lib 是筛选页：地址栏必须等于当前可见结果，切回时保留 q/pg/type/... */
      qs = buildUrlQuery();
    } else {
      const sp = new URLSearchParams();
      sp.set("view", state.view);
      if (dwIndex != null) sp.set("job", String(dwIndex));
      qs = sp.toString();
    }
  } else {
    qs = buildUrlQuery();
  }
  url.search = qs ? "?" + qs : "";
  url.hash = "";
  const next = url.href;
  if (next === location.href) return "";
  try {
    const st = { starta: 1, view: state.view, drawer: dwIndex != null ? 1 : 0 };
    if (mode === "push") history.pushState(st, "", next);
    else history.replaceState(st, "", next);
    return next;
  } catch (e) { return ""; }
}

/* 视图切换后的焦点兜底：优先 h1，其次页面容器（都补 tabindex=-1），并把主区滚回顶部 */
function focusViewPage(v) {
  const run = () => {
    try {
      const page = document.getElementById("view-" + v);
      if (!page) return;
      const h1 = page.querySelector("h1");
      const target = h1 || page;
      if (h1 && !h1.hasAttribute("tabindex")) h1.setAttribute("tabindex", "-1");
      if (target && typeof target.focus === "function") target.focus({ preventScroll: true });
      const main = document.querySelector(".main");
      if (main) main.scrollTop = 0;
    } catch (e) { /* 忽略 */ }
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else setTimeout(run, 0);
}

/* 搜索输入防抖：连续输入只在停顿 140ms 后渲染一次，避免每个字符全表扫 */
function scheduleRender() {
  if (__qRaf) clearTimeout(__qRaf);
  __qRaf = setTimeout(() => { __qRaf = 0; render(); }, 140);
}

function setView(v, opts) {
  if (!VIEW_LABEL[v]) v = "lib";
  const prevView = state.view;
  state.view = v;
  if (v !== "collect") noticeLink = null;   /* 离开情报采集就不在 URL 上继续带 notice */
  $$(".main .page").forEach(el => { el.hidden = el.id !== "view-" + v; });
  $$(".navi a").forEach(a => {
    if (a.dataset.view === v) a.setAttribute("aria-current", "page");
    else if (a.dataset.view) a.removeAttribute("aria-current");
  });
  setText(".topbar .crumb b", VIEW_LABEL[v]);
  try { document.documentElement.dataset.view = v; } catch (e) { /* 忽略 */ }
  /* 状态栏跟着当前视图走，别让门槛基准底下还留着「共 9,200 条 · 第 1/184 页」 */
  syncStatusText();
  if (v === "collect") { renderCitems(); renderCinfo(); }
  else if (v === "units") renderUnits();
  else if (v === "mine") renderMine();
  else if (v === "skill") renderSkill();
  else if (v === "me" && window.ME && typeof window.ME.render === "function") window.ME.render();
  startaTitle(v);   /* silent 也要设：hr-core 的 hardSwitch 依赖它 */
  if (!(opts && opts.silent)) {
    syncUrlState(prevView !== v ? "push" : "replace", { onlyView: true });
    focusViewPage(v);
  }
}

/* popstate 重放：写入 state → 同步筛选 UI → 输入框 → render → setView（顺序按契约来） */
function replayUrlState() {
  if (!__urlReady) return;
  const us = readUrlState();
  __urlMute = true;
  try {
    applyUrlToState(us, true);
    /* ?notice= 按 view 解释：lib=公告筛选；collect=正在看的公告；无 view 时兼容旧链接回落采集 */
    if (us.notice && us.view === "lib") state.noticeFilter = us.notice;
    syncFiltersUI();
    const qEl = $("#q");
    if (qEl) qEl.value = state.q;
    lastSig = filterSig();   /* URL 已带页码，别让 render 因筛选签名变化把页拉回第 1 页 */
    render();
    setView(us.notice && !us.view ? "collect" : (us.view || "lib"), { silent: true });
    if (us.notice && us.view !== "lib") {
      curNotice = us.notice;
      noticeLink = us.notice;
      renderCitems();
      renderCinfo();
    }
    /* 抽屉与 URL 对齐：后退到没有 job 的地址就关；前进到有 job 的地址就开（都不写历史） */
    const drawer = $("#drawer");
    const open = !!(drawer && drawer.classList.contains("on"));
    if (us.job !== null) {
      if (!open || dwIndex !== us.job) openDrawer(us.job, null, { history: false });
    } else if (open) {
      closeDrawer({ history: false });
    }
  } finally {
    __urlMute = false;
  }
  syncUrlState("replace");   /* 规范化：去掉 ?v= / hash / 越界页码 */
}

/* 浏览器后退/前进：HR 视图交给 hr-core，其余重放完整状态 */
window.addEventListener("popstate", () => {
  let raw = "";
  try {
    const sp = new URLSearchParams(location.search);
    raw = sp.get("view") || sp.get("v") || "";
  } catch (e) { /* ignore */ }
  if (window.HR && window.HR.views && window.HR.views[raw]) return;
  replayUrlState();
});
/* #view-x：没有 ?view/?v 时支持 hash 直达；hashchange 时同样切换并规范化地址 */
window.addEventListener("hashchange", () => {
  if (!__urlReady || __urlMute) return;
  let sp;
  try { sp = new URLSearchParams(location.search); } catch (e) { return; }
  if (sp.has("view") || sp.has("v")) return;
  const us = readUrlState();
  if (!us.view) return;
  setView(us.view, { silent: true });
  syncUrlState("replace", { onlyView: true });
});

/* ---------------- 竞争雇主 ---------------- */
/* 单位 → 最早截止日：全表扫一次建索引。
   旧实现 unitDue(u) 内部 DATA.filter 扫 9,200 行，而 unitGroups() 会对 4,519 个单位各调一次
   ≈ 4,100 万次迭代（实测单次切「竞争雇主」248-313ms）。 */
let __unitDueMap = null;
function unitDueMap() {
  if (__unitDueMap) return __unitDueMap;
  const map = new Map();
  DATA.forEach(d => {
    if (!d || !d.u || dueRank(d.d) >= 9999) return;
    const cur = map.get(d.u);
    if (cur === undefined || dueRank(d.d) < dueRank(cur)) map.set(d.u, d.d);
  });
  __unitDueMap = map;
  return map;
}
function unitDue(u) { return unitDueMap().get(u) || ""; }
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
/* DATA 运行期只读（全脚本没有 push/splice），分组结果可以整页复用 */
let __unitGroupsCache = null;
function unitGroups() {
  if (__unitGroupsCache) return __unitGroupsCache;
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
  __unitGroupsCache = arr;
  return arr;
}
/* 4,512 组的排序与筛选无关（总序：岗位数降序 → 单位名 zh 排序），预排一次即可；
   旧实现每次切「竞争雇主」都对全部 4,512 组跑 localeCompare 排序（实测 7.6ms/次）。 */
let __unitSorted = null;
function unitGroupsSorted() {
  if (__unitSorted) return __unitSorted;
  const coll = new Intl.Collator("zh");
  __unitSorted = unitGroups().slice().sort((a, b) => b.n - a.n || coll.compare(String(a.u), String(b.u)));
  return __unitSorted;
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
      return `<button class="chip" data-utype="${esc(t)}" aria-pressed="${String(state.uType === t)}">${esc(t)}<span class="ct">${n.toLocaleString("zh-CN")}</span></button>`;
    }).join("");
  }
  const kw = String(state.uQ || "").trim().toLowerCase();
  const all = unitGroupsSorted()
    .filter(g => state.uType === "全部" || g.t === state.uType)
    .filter(g => !kw
      || String(g.u).toLowerCase().indexOf(kw) >= 0
      || String(g.city || "").indexOf(kw) >= 0
      || (g.roles || []).some(r => String(r).indexOf(kw) >= 0));
  setText("#uCount", all.length.toLocaleString("zh-CN"));
  const per = 40;
  const pages = Math.max(1, Math.ceil(all.length / per));
  if (state.uPage > pages - 1) state.uPage = pages - 1;
  if (state.uPage < 0) state.uPage = 0;
  const from = state.uPage * per;
  const list = all.slice(from, from + per);
  // 6 列：单位（含城市）/ 性质 / 岗位数 / 最近截止 / 在招岗位 / 操作
  // 顺序按 styles.css 里 #view-units 的列宽模板（200/110/96/88/1fr/116）排，
  // 让「截止」拿窄列、「岗位」拿 1fr，避免岗位名被压成 88px 截断。
  head.innerHTML = [
    ["c-unit", "雇主 / 城市"],
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
    : `<div class="empty"><b>没有匹配的雇主</b>换个关键词，或者点「全部」回到 ${groups.length.toLocaleString("zh-CN")} 家。</div>`;
  const pg = $("#upager");
  if (pg) {
    if (!all.length) { pg.innerHTML = `<span class="pg-meta">共 0 家</span>`; return; }
    const last = Math.min(from + per, all.length);
    pg.innerHTML = `<span class="pg-meta">${(from + 1).toLocaleString("zh-CN")}–${last.toLocaleString("zh-CN")} / 共 ${all.length.toLocaleString("zh-CN")} 家</span>
      <div class="pg-nums">
        <button class="pg-btn" data-upage="${state.uPage - 1}" ${state.uPage === 0 ? "disabled" : ""} aria-label="上一页">‹</button>
        ${pageWindow(state.uPage, pages)}
        <button class="pg-btn" data-upage="${state.uPage + 1}" ${state.uPage >= pages - 1 ? "disabled" : ""} aria-label="下一页">›</button>
      </div>
      <span class="pg-meta">第 ${state.uPage + 1} / ${pages} 页 · 每页 ${per} 家</span>`;
  }
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

/* ---------------- 对标清单 ---------------- */
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
/* 对标集口径汇总：把收进来的岗位压成一句能进简报的话（学历/经验门槛、名额中位、最近关窗） */
function briefStats(list) {
  const tally = arr => {
    const m = new Map();
    arr.forEach(v => { if (v) m.set(v, (m.get(v) || 0) + 1); });
    return Array.from(m).sort((a, b) => b[1] - a[1]);
  };
  const nums = list.map(d => Number(d.n) || 0).filter(v => v > 0).sort((a, b) => a - b);
  const dues = list.map(d => d.d).filter(Boolean).sort((a, b) => dueRank(a) - dueRank(b));
  return {
    edu: tally(list.map(d => d.e || "")),
    exp: tally(list.map(d => d.x || "")),
    mid: nums.length ? nums[Math.floor((nums.length - 1) / 2)] : 0,
    due: dues[0] || "—",
    units: new Set(list.map(d => d.u).filter(Boolean)).size
  };
}
function renderBrief(list) {
  const box = $("#mbrief");
  if (!box) return;
  if (!list || !list.length) { box.hidden = true; box.innerHTML = ""; return; }
  const b = briefStats(list);
  const pair = rows => rows.slice(0, 2).map(r => `${esc(r[0])} <b>${r[1]}</b>`).join(" / ") || "—";
  box.hidden = false;
  box.innerHTML = `<div class="bf-h">对标集口径 / BENCHMARK SET</div>
    <div class="bf-grid">
      <div><div class="k">样本</div><div class="v"><b>${list.length}</b> 条 <span>· ${b.units} 位雇主</span></div></div>
      <div><div class="k">学历门槛</div><div class="v">${pair(b.edu)}</div></div>
      <div><div class="k">经验门槛</div><div class="v">${pair(b.exp)}</div></div>
      <div><div class="k">名额中位</div><div class="v"><b>${b.mid}</b> 人</div></div>
      <div><div class="k">最近关窗</div><div class="v"><b>${esc(b.due)}</b></div></div>
    </div>`;
}
function renderMine() {
  const head = $("#mhead"), box = $("#mrows"), fun = $("#mfunnel");
  if (!head || !box) return;
  // 对标清单：勾选 / 单位 / 岗位 / 研判阶段 / 停留 / 截止 / 专业 / 学历·经验 / 名额 / 操作
  head.innerHTML = [
    ["c-check", ""],
    ["c-unit", "单位"],
    ["c-role", "岗位"],
    ["c-stage", "研判阶段"],
    ["c-age", "停留"],
    ["c-due", "截止"],
    ["c-major", "专业"],
    ["c-dim c-edu", "学历 / 经验"],
    ["c-num", "名额"],
    ["c-op", "操作"]
  ].map(h => `<span class="${h[0]}">${esc(h[1])}</span>`).join("");

  const list = savedJobs();
  renderBrief(list);

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
  /* 分页：对标量大时（旧版曾一次写入上千条）只画当页 50 行，统计/漏斗/导出仍按全集 */
  const per = state.pgSize;
  const mpages = Math.max(1, Math.ceil(shown.length / per));
  if (state.mPage > mpages - 1) state.mPage = mpages - 1;
  if (state.mPage < 0) state.mPage = 0;
  const mfrom = state.mPage * per;
  const mslice = shown.slice(mfrom, mfrom + per);
  box.innerHTML = mslice.length ? mslice.map(d => {
    const st = stageOf(d.i), age = ageOf(d.i), left = dleft(d);
    const ageTxt = age == null ? "—" : age === 0 ? "今天" : age + " 天前";
    const dueCls = left == null ? "" : left < 0 ? " expired" : left <= 7 ? " soon" : "";
    const dueDate = d.end || d.d;
    const dueTxt = left == null ? `${esc(dueDate)}<small>长期</small>`
      : left < 0 ? `${esc(dueDate)}<small>已截止</small>`
        : left === 0 ? `${esc(dueDate)}<small>今天截止</small>`
          : `${esc(dueDate)}<small>${left} 天</small>`;
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
      <span class="c c-op"><button class="go" data-open="${d.i}">详情</button><button class="go star" data-save="${d.i}" data-name="${esc(d.r)}" aria-pressed="true" aria-label="移出对标集 ${esc(d.r)}">★</button></span>
    </div>`;
  }).join("")
    : (state.mineSt
      ? `<div class="empty"><b>「${esc(STAGE_I[state.mineSt].lb)}」这一档还没有岗位</b>点上面亮着的阶段卡回到全部，或者去市场岗位库把新岗位收进来。</div>`
      : `<div class="empty"><b>对标集还是空的</b>去市场岗位库点一下 ☆，或者在任意岗位的展开行里点一个研判阶段，收进来的岗位会存在本地，刷新也不丢。</div>`);
  const mp = $("#mpager");
  if (mp) {
    if (!shown.length) { mp.innerHTML = ""; }
    else {
      const mfirst = (mfrom + 1).toLocaleString("zh-CN");
      const mlast = Math.min(mfrom + per, shown.length).toLocaleString("zh-CN");
      mp.innerHTML = `<span class="pg-meta">${mfirst}–${mlast} / 共 ${shown.length.toLocaleString("zh-CN")} 条</span>
        <div class="pg-nums">
          <button class="pg-btn pg-prev" data-mpage="${state.mPage > 0 ? state.mPage - 1 : 0}" ${state.mPage === 0 ? "disabled" : ""} aria-label="上一页">‹</button>
          ${pageWindow(state.mPage, mpages, "mpage")}
          <button class="pg-btn pg-next" data-mpage="${state.mPage + 1}" ${state.mPage >= mpages - 1 ? "disabled" : ""} aria-label="下一页">›</button>
        </div>
        <span class="pg-meta">第 ${state.mPage + 1} / ${mpages} 页 · 每页 ${per}</span>`;
    }
  }
}
function exportMine() {
  const list = savedJobs();
  if (!list.length) { toast("对标集还是空的，先去市场岗位库点个星"); return; }
  const n = csvDownload(
    ["单位", "岗位", "研判阶段", "上次更新", "停留天数", "性质", "专业", "学历", "经验", "名额", "截止", "报名渠道", "城市"],
    list.map(d => {
      const age = ageOf(d.i);
      return [d.u, d.r, stageOf(d.i).lb, (state.prog[d.i] || {}).at || "", age == null ? "" : age,
        d.t, d.m, d.e, d.x, d.n, d.d, d.w, d.city];
    }),
    `starta-对标清单-${list.length}条.csv`
  );
  toast(`已导出对标清单 ${n} 条`);
}

/* ---------------- 门槛基准 ---------------- */
/* 一条岗位的某个字段可能是「/」拼起来的多值（专业门类），拆开各记一次 */
function distCount(list, keyFn) {
  const m = new Map();
  (list || []).forEach(d => {
    if (!d) return;
    const k = keyFn(d);
    if (!k) return;
    String(k).split("/").forEach(t => {
      const v = t.trim();
      if (!v) return;
      m.set(v, (m.get(v) || 0) + 1);
    });
  });
  return Array.from(m, ([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n);
}
const SKILL_GROUPS = [
  { k: "e", t: "学历门槛", h: "岗位表里写的最低可报学历（本科以上 / 硕士以上这类标签）" },
  { k: "deg", t: "学位要求", h: "学位证书要求，和学历不是一回事" },
  { k: "mf", t: "专业门类", h: "专业代码映射到 13 个门类，一条岗位可挂多个" },
  { k: "city", t: "地区分布", h: "岗位落在哪个地市，直辖市与省直单列" },
  { k: "cand", t: "考生类别", h: "不限 / 应届毕业生，决定谁能报" },
  { k: "lv", t: "岗位等级", h: "管理岗与专业技术岗的等级口径" }
];
/* 兼容旧调用：门槛口径的「项数 / 样本量」 */
function skillRows(list) {
  const src = Array.isArray(list) ? list : DATA;
  return { sample: src.length, rows: distCount(src, d => d.e) };
}
function renderSkill() {
  const box = $("#skillBars");
  if (!box) return;
  const types = ["全部", "事业单位", "国企"];
  const cur = types.indexOf(state.skillType) >= 0 ? state.skillType : "全部";
  state.skillType = cur;
  const base = cur === "全部" ? DATA : DATA.filter(d => d && d.t === cur);
  const tb = $("#skillTypes");
  if (tb) {
    tb.innerHTML = types.map(t => {
      const n = t === "全部" ? DATA.length : DATA.filter(d => d && d.t === t).length;
      return `<button class="chip" data-stype="${esc(t)}" aria-pressed="${String(t === cur)}">${esc(t)}<span class="ct">${n.toLocaleString("zh-CN")}</span></button>`;
    }).join("");
  }
  const sample = base.length || 1;
  const blocks = SKILL_GROUPS.map(g => {
    const rows = distCount(base, d => d[g.k]);
    if (!rows.length) return "";
    const top = rows.slice(0, 7);
    const max = top[0].n || 1;
    return `<section class="sk-group">
      <div class="sk-gh"><b>${esc(g.t)}</b><span class="sk-sub">${esc(g.h)}</span></div>
      ${top.map(r => {
      const share = Math.round(r.n / sample * 100);
      return `<div class="bar-row" title="${esc(r.label)}：${r.n.toLocaleString("zh-CN")} 条（占样本 ${share}%）">
        <span class="bar-label" title="${esc(r.label)}">${esc(r.label)}</span>
        <i class="bar-fill" style="width:${Math.max(3, Math.round(r.n / Math.max(max, 1) * 100))}%"></i>
        <span class="bar-val">${r.n.toLocaleString("zh-CN")}</span>
      </div>`;
    }).join("")}
      ${rows.length > 7 ? `<div class="sk-more">另 ${rows.length - 7} 类未列（长尾：${esc(rows.slice(7, 10).map(r => r.label).join("、"))}…）</div>` : ""}
    </section>`;
  }).filter(Boolean).join("");
  box.innerHTML = `<div class="sk-h">门槛剖面 · ${cur === "全部" ? "全部性质" : esc(cur)} · 样本 ${base.length.toLocaleString("zh-CN")} 条</div>`
    + (blocks || `<div class="empty"><b>这一类还没有样本</b>换一类，或者先去市场岗位库补几条再看。</div>`);
}

/* ---------------- 总渲染 ---------------- */
/* 筛选条件一改就回第一页，不然用户会停在「第 137 页」上看三条结果 */
let lastSig = "";
function filterSig() {
  return [state.type, state.major, state.edu, state.q, state.quick, state.sort, state.dir, state.noticeFilter].join("\u0001");
}
function render() {
  const sig = filterSig();
  if (sig !== lastSig) { lastSig = sig; state.page = 0; }
  const full = filtered();
  pruneSel(full);
  const page = pageSlice(full);
  paintRows(page.slice);
  syncPager(full);
  syncCountText(full);
  syncTypebarCounts();
  syncSortUI();
  syncFiltersUI();
  syncBulk(page.slice);
  syncKPI();
  if (state.view === "units") renderUnits();
  else if (state.view === "mine") renderMine();
  else if (state.view === "skill") renderSkill();
  else if (state.view === "me" && window.ME && typeof window.ME.render === "function") window.ME.render();
  if (__urlReady) syncUrlState("replace");   /* 筛选 / 页码 / 排序 / 快捷的变化只替换当前历史 */
}

/* ======================================================================
   情报采集：2 份真实公告 + Lexmount 抓取链路
   —— 数据来自 assets/notices.data.js / collect.data.js，前端不再伪造公告
   ====================================================================== */
let curNotice = NOTICES.length ? NOTICES[0].id : null;
let cq = "";
let exOpen = false;

function stOf(n) {
  if (!n) return "pending";
  if (n.st === "parsing" || n.st === "error" || n.st === "pending") return n.st;
  return (n.rows > 0 || (n.attachments && n.attachments.length)) ? "ok" : "pending";
}
function statusInfo(n) {
  const st = stOf(n);
  if (st === "ok") return { cls: "ok", text: n.open ? "报名中" : "已截止" };
  if (st === "parsing") return { cls: "wait", text: "解析中" };
  return { cls: "wait", text: "待解析" };
}
function currentNotice() {
  let n = NOTICES.filter(x => x.id === curNotice)[0];
  if (!n) { n = NOTICES[0]; if (n) curNotice = n.id; }
  return n || null;
}
function rolesOfNotice(n) {
  if (!n) return [];
  return DATA.map((d, i) => Object.assign({}, d, { i })).filter(d => d && d.src === n.id);
}
function collectItems() {
  const c = window.STARTA_COLLECT;
  return (c && Array.isArray(c.items)) ? c.items : [];
}
function fmtNum(v) { return Number(v || 0).toLocaleString("zh-CN"); }
function hostOf(u) {
  try { return new URL(withScheme(u)).host; } catch (e) { return String(u || ""); }
}
function citemInner(n) {
  const info = statusInfo(n);
  const files = (n.attachments || []).length;
  return `<button class="citem" role="option" type="button" data-n="${esc(n.id)}" aria-selected="${n.id === curNotice}">
    <span class="ci-dot ${info.cls}" aria-hidden="true"></span>
    <span class="ci-main">
      <span class="ci-title">${esc(n.title)}</span>
      <span class="ci-meta">${esc(n.org || "")} · ${esc(n.published || "")} · 招 ${fmtNum(n.seats)} 人 · ${fmtNum(n.rows)} 条岗位 · ${files} 个附件</span>
    </span>
    <span class="ci-badge ${n.open ? "open" : "closed"}">${esc(n.status || (n.open ? "报名中" : "已截止"))}</span>
  </button>`;
}
function renderCitems() {
  const box = $("#citems");
  if (!box) return;
  const kw = String(cq || "").toLowerCase();
  const list = NOTICES.filter(n => !kw || `${n.title || ""} ${n.org || ""}`.toLowerCase().indexOf(kw) >= 0);
  const head = $("#cCount");
  if (head) head.textContent = kw ? `${list.length} / ${NOTICES.length} 份公告` : `${NOTICES.length} 份公告 · 全部已解析`;
  box.innerHTML = list.length
    ? list.map(citemInner).join("")
    : `<div class="empty"><b>没有匹配的公告</b>清空关键词再试。</div>`;
}
function attLink(a, extra) {
  const local = attUrl(a.local);
  const href = local || withScheme(a.url);
  if (!href) return "";
  return `<a class="att${extra || ""}" href="${esc(href)}" target="_blank" rel="noopener"${local ? " download" : ""}>
    <span class="att-fmt">${esc(a.fmt || "文件")}</span>
    <span class="att-name">${esc(a.name)}</span>
    ${a.size ? `<span class="att-size">${fmtSize(a.size)}</span>` : ""}
    <span class="att-go">${local ? "下载" : "原站"}</span>
  </a>`;
}
function renderCinfo() {
  const box = $("#cinfo");
  if (!box) return;
  const n = currentNotice();
  if (!n) {
    box.innerHTML = `<div class="empty"><b>还没有采集到公告</b>在上面粘贴一个公告地址，去源站抓一份回来。</div>`;
    return;
  }
  const roles = rolesOfNotice(n);
  const files = n.attachments || [];
  const timeline = n.timeline || [];
  const collect = collectItems();
  const preview = roles.slice(0, 12);
  const stored = NOTICES.map(x => x.id);
  const applyHref = withScheme(n.applyUrl) || "";
  box.innerHTML = `
  <div class="cinfo-hd">
    <div class="cinfo-tt">
      <div class="cinfo-kicker">公告原文 / NOTICE</div>
      <h2>${esc(n.title)}</h2>
      <p class="cinfo-meta">${esc(n.org || "")} · 发布于 ${esc(n.published || "")}${n.region ? " · " + esc(n.region) : ""} · 采集于 ${esc(fmtISO(n.collectedAt || (window.STARTA_COLLECT && window.STARTA_COLLECT.at) || ""))}</p>
    </div>
    <div class="cinfo-acts">
      <span class="ci-badge ${n.open ? "open" : "closed"} big">${esc(n.status || "")}</span>
      <a class="btn primary" href="${esc(noticeUrl(n))}" target="_blank" rel="noopener">打开公告原文 ↗</a>
    </div>
  </div>
  <div class="cinfo-facts">
    <div><div class="k">招聘人数</div><div class="v">${fmtNum(n.seats)} 人</div></div>
    <div><div class="k">岗位表行数</div><div class="v">${fmtNum(n.rows)} 条</div></div>
    <div><div class="k">报名期</div><div class="v">${esc(n.applyStart || "—")} → ${esc(n.applyEnd || "—")}</div></div>
    <div><div class="k">报名入口</div><div class="v">${applyHref ? `<a class="${lnkCls(applyHref)}" href="${esc(applyHref)}" target="_blank" rel="noopener"${deadTitle(applyHref) ? ` title="${esc(deadTitle(applyHref))}"` : ""}>${esc(hostOf(applyHref) || "—")}</a>${lnkDeadTag(applyHref)}` : `<span class="muted">—</span>`}</div></div>
  </div>
  ${n.open
      ? `<div class="callout ok"><b>${esc(n.status || "报名中")}</b>${esc(n.applyStart || "")} 起报名，<b>${esc(n.applyEnd || "")}</b> 截止${n.exam ? " · " + esc(n.exam) : ""}</div>`
      : `<div class="callout"><b>${esc(n.status || "已截止")}</b>报名窗口已在 ${esc(n.applyEnd || "")} 关闭；岗位仍留在库里，用来对标门槛。</div>`}
  <div class="cinfo-grid">
    <section class="ci-sec">
      <h3>附件 <span class="n">${files.length}</span></h3>
      ${files.length ? files.map(a => {
        const src = withScheme(a.url) || "";
        return `<div class="att-row">${attLink(a)}${src ? `<a class="att-src" href="${esc(src)}" target="_blank" rel="noopener">原站链接 ↗</a>` : ""}</div>`;
      }).join("") : `<p class="muted">这份公告没有可下载的附件。</p>`}
    </section>
    <section class="ci-sec">
      <h3>招聘流程 <span class="n">${timeline.length}</span></h3>
      ${timeline.length ? `<ol class="tl">${timeline.map(x => `<li><span class="tl-t">${esc(x.t)}</span><span class="tl-e">${esc(x.e)}</span></li>`).join("")}</ol>` : `<p class="muted">公告原文没给出流程细节。</p>`}
    </section>
  </div>
  <section class="ci-sec">
    <h3>岗位表预览 <span class="n">${preview.length} / ${fmtNum(roles.length)}</span></h3>
    ${preview.length ? `<div class="tablewrap ci-table"><table>
      <thead><tr><th>单位</th><th>岗位代码</th><th>部门 / 岗位</th><th>专业</th><th>学历 / 学位</th><th>名额</th><th></th></tr></thead>
      <tbody>${preview.map(d => `<tr>
        <td class="c-unit" title="${esc(d.u)}">${esc(d.u)}</td>
        <td class="mono">${esc(d.code || "—")}</td>
        <td>${esc(d.dept || d.r)}</td>
        <td class="c-major" title="${esc(d.m)}">${esc(d.m)}</td>
        <td>${esc(d.e)} / ${esc(d.deg || "不限")}</td>
        <td class="c-num">${d.n} 人</td>
        <td><button class="go" data-open="${d.i}">详情</button></td>
      </tr>`).join("")}</tbody></table></div>
      <div class="ci-acts"><button class="btn" id="expNotice">导出这份岗位表 CSV</button><button class="btn ghost" data-notice-jump="${esc(n.id)}">去市场岗位库看全部 ${fmtNum(roles.length)} 条</button></div>`
      : `<p class="muted">这份公告还没有解析出岗位行。</p>`}
  </section>
  <section class="ci-sec">
    <h3>采集链路 <span class="n">${collect.length} 个源</span></h3>
    ${collect.length ? `<div class="tablewrap ci-table"><table>
      <thead><tr><th>状态</th><th>来源</th><th>页面标题</th><th>字符</th><th>附件</th><th>归属</th></tr></thead>
      <tbody>${collect.map(it => {
        const srcOk = it.status === "ok";
        const to = it.url;
        return `<tr>
          <td><span class="ci-dot ${srcOk ? "ok" : "wait"}" aria-hidden="true"></span>${srcOk ? "已抓取" : "空页"}</td>
          <td class="mono" title="${esc(it.host || "")}">${esc(it.host || "—")}</td>
          <td class="c-major"><a class="${lnkCls(to)}" href="${esc(to)}" target="_blank" rel="noopener" title="${esc(deadTitle(to) || it.title || "")}">${esc(it.title || it.url)}</a>${lnkDeadTag(to)}</td>
          <td class="c-num">${fmtNum(it.chars)}</td>
          <td class="c-num">${fmtNum(it.files && it.files.length)}</td>
          <td>${(it.stored && it.stored.length) ? it.stored.map(id => {
          const nt = NOTICES.filter(x => x.id === id)[0];
          return `<span class="stored">${esc(nt ? nt.id : id)}</span>`;
        }).join("") : "—"}</td>
        </tr>`;
      }).join("")}</tbody></table></div>`
      : `<p class="muted">采集日志里没有找到来源记录。</p>`}
  </section>
  <section class="ci-sec">
    <h3>原文摘要</h3>
    <p class="ci-sum">${esc(n.summary || "公告原文摘要暂缺。")}</p>
    <div class="ci-acts">
      <button class="btn ghost" id="expNotice2">导出岗位表 CSV</button>
      <a class="btn ghost" href="${esc(noticeUrl(n))}" target="_blank" rel="noopener">打开公告原文 ↗</a>
    </div>
  </section>`;
}

/* 采集按钮：只认库里已有的两份公告地址，别在前端假装能抓任何站点 */
function startCrawl(raw) {
  const url = String(raw || "").trim();
  if (!url) { toast("粘贴一个公告地址，或者点列表里的「打开公告原文」"); return; }
  const hit = NOTICES.filter(n => noticeUrl(n) && (noticeUrl(n) === withScheme(url) || withScheme(url).indexOf(n.url || "§") >= 0))[0];
  if (hit) {
    curNotice = hit.id;
    renderCitems();
    renderCinfo();
    toast(`这份公告已在库里：${hit.title.slice(0, 18)}…`);
    return;
  }
  toast("演示版只内联了 2 份已采集公告；新地址请到采集台抓完再入库");
}
function runParse(n) {
  if (!n) return;
  toast("这份公告的岗位表已经在本地，无需重新解析");
}
function exportNoticeCsv(n) {
  if (!n) return;
  const roles = rolesOfNotice(n);
  if (!roles.length) { toast("这条公告没有解析出岗位"); return; }
  const num = csvDownload(
    ["岗位代码", "单位", "岗位", "部门", "等级", "专业", "学历", "学位", "考生类别", "名额", "截止", "公告原文"],
    roles.map(r => [r.code, r.u, r.r, r.dept, r.lv, r.m, r.e, r.deg, r.cand, r.n, r.end || r.d, noticeUrl(n)]),
    `starta-${n.id}-岗位-${roles.length}条.csv`
  );
  toast(`已导出 ${fmtNum(num)} 条岗位 CSV`);
}

/* ---------------- 事件绑定 ---------------- */
function bindEvents() {
  /* 市场岗位库筛选 */
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
    setText("#statusCount", `门槛口径 ${sr.rows.length} 项 · 样本 ${sr.sample} 条`);
  });
  on("#major", "change", e => { state.major = e.target.value; persistFilters(); render(); });
  on("#edu", "change", e => { state.edu = e.target.value; persistFilters(); render(); });
  /* 搜索：非岗位库视图里输入就先切回岗位库；140ms 防抖，连打多个字符只渲染一次 */
  on("#q", "input", e => {
    state.q = e.target.value.trim();
    state.page = 0;
    persistFilters();
    if (state.view !== "lib") {
      setView("lib", { silent: true });
      syncUrlState("push", { onlyView: true });
    }
    scheduleRender();
  });
  on("#q", "keydown", e => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (__qRaf) { clearTimeout(__qRaf); __qRaf = 0; }
      state.q = "";
      e.target.value = "";
      state.page = 0;
      persistFilters();
      render();
    }
  });
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
    state.noticeFilter = null;
    state.page = 0;            /* 重置后回到第 1 页，不能停在旧页码 */
    const q = $("#q"); if (q) q.value = "";
    persistFilters();
    mountFilters();
    render();
    toast("筛选、排序与展开已重置");
  });

  /* KPI 卡就是入口：紧急卡只筛 7 天内关窗，对标卡只筛已对标，雇主卡跳竞争雇主 */
  function hitKPI(e) {
    const card = e.target.closest ? e.target.closest(".kpi[role='button']") : null;
    if (!card) return;
    if (card.dataset.goview) { setView(card.dataset.goview); toast("已跳到竞争雇主，按雇主看岗位"); return; }
    const q = card.dataset.quick;
    state.quick = (q === "all" || q === state.quick) ? null : q;
    state.sel.clear();
    persistFilters();
    render();
    const k = KPIS();
    toast(state.quick === "urgent" ? `只显示 7 天内截止的 ${k.urgent7.toLocaleString("zh-CN")} 个岗位`
      : state.quick === "saved" ? `只显示对标集里的 ${state.saved.size.toLocaleString("zh-CN")} 个岗位`
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
    /* 列表/展开行里的「看公告原文与附件」：左键走 SPA 切到情报采集，中键/修饰键保持浏览器默认 */
    const nj = e.target.closest("[data-notice-jump]");
    if (nj) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      curNotice = noticeLink = nj.dataset.noticeJump;
      setView("collect");
      renderCitems();
      renderCinfo();
      syncUrlState("replace");
      const cbox = $("#cinfo");
      if (cbox) { try { cbox.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (err) { window.scrollTo(0, 0); } }
      return;
    }
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
      copyAndToast(copyTarget(d), "已复制报名渠道", "复制失败：请手动选中「报名渠道」再复制");
      return;
    }
    const star = e.target.closest("[data-save]");
    if (star) {
      const i = Number(star.dataset.save);
      const next = setSaved(i, !state.saved.has(i));
      toast(next ? "已加入对标清单" : "已移出对标集");
      return;
    }
    const ap = e.target.closest("[data-apply]");
    if (ap) {
      const i = Number(ap.dataset.apply);
      const d = byId.get(i);
      if (!d) return;
      if (!(window.ME && typeof window.ME.add === "function")) { toast("个人中心还没加载完，稍等一下"); return; }
      const ok = window.ME.add(Object.assign({}, d, { i: i }));
      syncKPI();
      syncStatusText();
      if (ok) { ap.textContent = "已投递"; ap.classList.add("done"); toast("已投递 · 去「个人中心」补资料并打印报名表"); }
      else { ap.classList.add("done"); ap.textContent = "已投递"; toast("这个岗位已经在投递记录里了"); }
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
  /* 行键盘：上下移动焦点、Home/End 到首尾、Enter 打开抽屉；不改鼠标行为 */
  on("#rows", "keydown", e => {
    const key = e.key;
    if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End" && key !== "Enter") return;
    if (e.target.closest("button, a, input, select, textarea")) return;
    if (key === "Enter") {
      const tr = e.target.closest("tr[data-i]");
      if (!tr) return;
      e.preventDefault();
      openDrawer(Number(tr.dataset.i), tr);
      return;
    }
    const rows = $$("#rows tr[data-i]");
    if (!rows.length) return;
    const cur = e.target.closest("tr[data-i]");
    let idx = cur ? rows.indexOf(cur) : -1;
    if (key === "Home") idx = 0;
    else if (key === "End") idx = rows.length - 1;
    else if (key === "ArrowDown") idx = idx < 0 ? 0 : Math.min(idx + 1, rows.length - 1);
    else idx = idx < 0 ? rows.length - 1 : Math.max(idx - 1, 0);
    const next = rows[idx];
    if (!next) return;
    e.preventDefault();
    if (!next.hasAttribute("tabindex")) next.setAttribute("tabindex", "-1");
    next.focus({ preventScroll: true });
    try { next.scrollIntoView({ block: "nearest" }); } catch (err) { /* 忽略 */ }
  });
  on("#checkAll", "change", e => {
    /* 表头复选框语义是「全选本页」：只动当前页 50 行，不能把 9,200 行全画进 DOM */
    const page = pageSlice(filtered()).slice;
    if (e.target.checked) page.forEach(d => state.sel.add(d.i));
    else page.forEach(d => state.sel.delete(d.i));
    e.target.indeterminate = false;
    render();
  });
  on("#clearSel", "click", () => { state.sel.clear(); render(); });
  on("#saveSel", "click", () => {
    const list = visibleSelected();
    if (!list.length) { toast("先勾选要对标的岗位"); return; }
    setSavedMany(list, true);
    state.sel.clear();
    render();
    toast(`已对标 ${list.length} 条岗位`);
  });
  on("#copySel", "click", () => {
    const list = visibleSelected();
    if (!list.length) { toast("先勾选要复制的岗位"); return; }
    const text = list.map(d => `${d.u || ""} ${d.r || ""}\t${copyTarget(d)}`).join("\n");
    copyAndToast(text, `已复制 ${list.length} 条报名渠道`, "复制失败：请检查浏览器剪贴板权限");
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

  /* 竞争雇主 / 对标清单 */
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
      toast(next ? "已加入对标清单" : "已移出对标集");
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
  /* 对标清单分页：只重画当页，漏斗/统计/导出仍按全集 */
  on("#mpager", "click", e => {
    const b = e.target.closest("[data-mpage]");
    if (!b || b.disabled) return;
    const p = Number(b.dataset.mpage);
    if (!isFinite(p) || p === state.mPage) return;
    state.mPage = Math.max(0, p);
    renderMine();
    const wrap = $("#mrows");
    if (wrap) {
      const top = wrap.getBoundingClientRect().top + window.scrollY - 96;
      try { window.scrollTo({ top, behavior: "smooth" }); } catch (err) { window.scrollTo(0, top); }
    }
  });

  /* 列表分页：换页只重画表格，不重建 DOM 之外的东西 */
  on("#pager", "click", e => {
    const b = e.target.closest("[data-page]");
    if (!b || b.disabled) return;
    const p = Number(b.dataset.page);
    if (!isFinite(p) || p === state.page) return;
    state.page = Math.max(0, p);
    render();
    const wrap = $("#rows");
    if (wrap) {
      const top = wrap.getBoundingClientRect().top + window.scrollY - 96;
      try { window.scrollTo({ top, behavior: "smooth" }); } catch (err) { window.scrollTo(0, top); }
    }
  });
  /* 竞争雇主分页 + 雇主搜索 */
  on("#upager", "click", e => {
    /* 数字页码由 pageWindow() 生成，带的是 data-page；箭头才是 data-upage。
       之前只认 data-upage，导致数字页码点了没反应。 */
    const b = e.target.closest("[data-upage],[data-page]");
    if (!b || b.disabled) return;
    const p = Number(b.dataset.upage != null && b.dataset.upage !== "" ? b.dataset.upage : b.dataset.page);
    if (!isFinite(p)) return;
    state.uPage = Math.max(0, p);
    renderUnits();
    syncStatusText();
  });
  on("#uq", "input", e => { state.uQ = e.target.value.trim(); state.uPage = 0; renderUnits(); syncStatusText(); });

  /* 批量投递 */
  on("#applySel", "click", () => {
    const picks = visibleSelected();
    if (!picks.length) { toast("先勾选几条岗位"); return; }
    if (!(window.ME && typeof window.ME.addMany === "function")) { toast("个人中心还没加载完，稍等一下"); return; }
    const n = window.ME.addMany(picks);
    syncKPI();
    syncStatusText();
    toast(n ? `已投递 ${n} 个岗位，去个人中心看进度` : "这几条都已经投过了");
    if (n && state.saved.size >= 0) { /* 勾选留着，方便继续看 */ }
  });

  /* 顶部提示条 */
  on("#bannerClose", "click", () => { const b = $("#banner"); if (b) b.hidden = true; });
  on("#banner", "click", e => {
    const b = e.target.closest("[data-notice-jump]");
    if (!b) return;
    /* 中键 / Ctrl / Shift / Cmd 点击交给浏览器，让「新标签打开」照常工作 */
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    curNotice = b.dataset.noticeJump;
    noticeLink = curNotice;
    setView("collect");
    renderCitems();
    renderCinfo();
    syncUrlState("replace");
    const box = $("#cinfo");
    if (box) { try { box.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (err) { window.scrollTo(0, 0); } }
  });

  /* 抽屉里投递 */
  on("#dwApply", "click", () => {
    if (dwIndex == null) return;
    const d = byId.get(dwIndex);
    if (!d) return;
    if (!(window.ME && typeof window.ME.add === "function")) { toast("个人中心还没加载完"); return; }
    const ok = window.ME.add(Object.assign({}, d, { i: dwIndex }));
    const btn = $("#dwApply");
    if (btn) { btn.textContent = "已投递 · 去个人中心看"; btn.classList.toggle("done", true); }
    syncKPI();
    syncStatusText();
    toast(ok ? "已投递，去个人中心补资料并打印报名表" : "这个岗位已经在投递记录里了");
  });
  /* 漏斗：点一次筛这一档，再点一次取消 */
  on("#mfunnel", "click", e => {
    const b = e.target.closest("[data-mst]");
    if (!b) return;
    const k = b.dataset.mst;
    state.mineSt = (state.mineSt === k) ? null : k;
    state.mPage = 0;
    renderMine();
    syncStatusText();
    const n = state.mineSt ? savedJobs().filter(d => stageOf(d.i).k === state.mineSt).length : savedJobs().length;
    toast(state.mineSt ? `只看「${STAGE_I[k].lb}」：${n} 条` : "已回到全部");
  });

  /* 抽屉 */
  /* 复制链接：把当前岗位的深链复制给同事；file:// 下没有可分享的 origin，给出提示 */
  on("#dwCopyLink", "click", () => {
    if (dwIndex == null) return;
    let base = "";
    try {
      if (location.protocol === "file:") { toast("file:// 打开时没有可分享的网址，请用本地服务地址"); return; }
      base = location.origin + location.pathname;
    } catch (e) { toast("当前环境拿不到页面地址"); return; }
    copyAndToast(base + "?view=lib&job=" + dwIndex, "岗位链接已复制", "复制失败：请手动复制地址栏");
  });
  on("#dwClose", "click", closeDrawer);
  on("#scrim", "click", closeDrawer);
  on("#dwStages", "click", e => {
    const b = e.target.closest("[data-stage]");
    if (b) setStage(Number(b.dataset.stage), b.dataset.st);
  });
  on("#dwSave", "click", () => {
    if (dwIndex == null) return;
    const next = setSaved(dwIndex, !state.saved.has(dwIndex));
    toast(next ? "已加入对标清单" : "已移出对标集");
  });
  on("#dwGo", "click", () => { if (dwIndex != null) openJobUrl(byId.get(dwIndex)); });

  /* 情报采集 */
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
      const hay = `${n.org || ""} ${n.title || ""}`.toLowerCase();
      if (hay.indexOf(seq) >= 0 && bestIdx < 0) { best = n; bestIdx = i; }
    });
    if (!best) return null;
    curNotice = best.id;
    noticeLink = curNotice;
    renderCitems();
    renderCinfo();
    syncUrlState("replace");
    syncCountText(filtered());
    const sel = document.querySelector(`#citems .citem[data-n="${best.id}"]`);
    if (sel && sel.focus) sel.focus({ preventScroll: false });
    /* 状态栏闪一下「跳到：标题」，比在列表里塞提示条干净 */
    setText("#statusCount", "跳到：" + (best.title || ""));
    clearTimeout(window.__taStatusT);
    window.__taStatusT = setTimeout(() => {
      const sr = skillRows(state.skillType === "全部" ? DATA : DATA.filter(d => d && d.t === state.skillType));
      if (state.view === "collect") setText("#statusCount", `采集 ${NOTICES.length} 条公告`);
      else if (state.view === "skill") setText("#statusCount", `门槛口径 ${sr.rows.length} 项 · 样本 ${sr.sample} 条`);
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
    noticeLink = curNotice;
    renderCitems();
    renderCinfo();
    syncUrlState("replace");
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
    const jump = e.target.closest("[data-notice-jump]");
    if (jump) {
      state.noticeFilter = jump.dataset.noticeJump;
      state.quick = null;
      state.page = 0;
      setView("lib");
      render();
      toast("已筛到这份公告的岗位");
      return;
    }
    const jum = e.target.closest("[data-n]");
    if (jum) { curNotice = jum.dataset.n; noticeLink = curNotice; renderCitems(); renderCinfo(); syncUrlState("replace"); return; }
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
    } else if (e.target.closest("#expNotice, #expNotice2")) {
      exportNoticeCsv(n);
    } else if (e.target.closest("#openSrc")) {
      const url = noticeUrl(n);
      if (!url) { toast("这条公告还没有可打开的原文地址"); return; }
      window.open(url, "_blank", "noopener");
    }
  });

  /* 快捷键 */
  document.addEventListener("keydown", e => {
    /* 全局 /：直接聚焦搜索框（焦点在输入类元素里时不抢） */
    if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const t = e.target;
      const tag = t && t.tagName ? t.tagName.toLowerCase() : "";
      const typing = tag === "input" || tag === "textarea" || tag === "select" || !!(t && t.isContentEditable);
      if (!typing) {
        e.preventDefault();
        if (state.view !== "lib") setView("lib");
        const q = $("#q");
        if (q) requestAnimationFrame(() => { q.focus(); q.select(); });
      }
      return;
    }
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
  // 竞争雇主 / 对标清单的 div 表格已由 HTML 带 .u / .m 修饰类，列宽交给 ui，这里不再叠类
}

/* ---------------- 启动 ---------------- */
(function init() {
  applyTheme();
  setDensity(lsGet(LS.density, "loose"));
  const savedFs = parseFloat(lsGet(LS.fs, ""));
  applyFs(Number.isFinite(savedFs) ? FS_STEPS.reduce((b, s) => Math.abs(s - savedFs) < Math.abs(b - savedFs) ? s : b, FS_STEPS[1]) : 17, true);

  /* 后退/前进时浏览器别自作主张恢复滚动位置，视图由我们自己重放 */
  try { if ("scrollRestoration" in history) history.scrollRestoration = "manual"; } catch (e) { /* file:// 等环境忽略 */ }

  restoreSaved();
  restoreFilters();
  mountTypebar();
  reindex();
  initA11y();

  /* URL 优先于 localStorage：URL 上出现的参数覆盖本地记忆（?q= 空串 = 清空搜索） */
  const us = readUrlState();
  applyUrlToState(us, false);
  syncFiltersUI();
  const q = $("#q");
  if (q) q.value = state.q;

  /* ?notice= 按 view 解释：lib=公告筛选；collect=正在看的公告；单独出现时兼容旧链接回落到采集 */
  if (us.notice && us.view === "lib") state.noticeFilter = us.notice;
  lastSig = filterSig();   /* 深链带页码时别被筛选签名变化拉回第 1 页 */
  render();
  if (us.notice && us.view !== "lib") { curNotice = us.notice; noticeLink = us.notice; }
  renderCitems();
  renderCinfo();
  setView(us.notice && !us.view ? "collect" : (us.view || "lib"), { silent: true });
  bindEvents();

  /* 深链：?job=<行号> 直接打开那条岗位的抽屉；boot 场景不压历史，收起时只替换地址 */
  if (us.job !== null) openDrawer(us.job, null, { history: false });

  /* 从这里开始，所有筛选 / 视图 / 抽屉变化才回写 URL */
  __urlReady = true;
  syncUrlState("replace");

  /* me.js 在 app.js 之后加载：等 DOM 都就绪再补一次 KPI / 状态栏，
     否则侧栏「个人中心」计数会在首屏停在 0 */
  function afterMeReady() {
    try {
      if (window.ME) { syncKPI(); syncStatusText(); if (state.view === "me") window.ME.render(); }
    } catch (e) { /* 个人中心异常不影响主表 */ }
  }
  if (document.readyState === "complete") setTimeout(afterMeReady, 0);
  else window.addEventListener("load", () => setTimeout(afterMeReady, 0));
})();
