/* =====================================================================
   个人中心 / 投递记录（assets/me.js）
   —— 只做本地持久化（localStorage "strata-me-v1"），不发请求
   —— 依赖 app.js 暴露的全局：esc / toast / $ / noticeOf / noticeUrl / csvDownload / todayDate
   ===================================================================== */
window.ME = (function () {
  const KEY = "strata-me-v1";
  const APP_STATUS = ["已投递", "已确认", "笔试", "面试", "已录取", "未通过"];
  /* 字段 → 权重（合计 100），完整度按填了哪些算 */
  const FIELDS = [
    ["name", "姓名", 8], ["gender", "性别", 3], ["birth", "出生年月", 4], ["politics", "政治面貌", 3],
    ["phone", "手机", 8], ["email", "邮箱", 7], ["idcard", "身份证号", 6],
    ["edu", "最高学历", 8], ["degree", "学位", 5], ["school", "毕业院校", 7], ["major", "专业", 7],
    ["grad", "毕业时间", 5], ["years", "工作年限", 5], ["city", "期望地区", 5], ["want", "求职意向", 6], ["intent", "意向岗位", 7],
    ["resume", "简历附件", 8]
  ];
  const TOTAL = FIELDS.reduce((s, f) => s + f[2], 0);

  let state = load();
  let hydrated = false;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const o = JSON.parse(raw);
        return { profile: (o && o.profile) || {}, apps: Array.isArray(o && o.apps) ? o.apps : [], savedAt: (o && o.savedAt) || "" };
      }
    } catch (e) { /* 隐私模式 / 坏数据都退回空 */ }
    return { profile: {}, apps: [], savedAt: "" };
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 忽略写入失败 */ }
  }
  function $(s, root) { return (root || document).querySelector(s); }
  function money(v) { return Number(v || 0).toLocaleString("zh-CN"); }

  /* ---------- 完整度 ---------- */
  function score() {
    let got = 0;
    FIELDS.forEach(([k, , w]) => { if (String(state.profile[k] || "").trim()) got += w; });
    return Math.round(got / TOTAL * 100);
  }
  function count() { return state.apps.length; }

  /* ---------- 投递记录 ---------- */
  function appKey(i) { return String(i); }
  function has(i) {
    const k = appKey(i);
    return state.apps.some(a => String(a.i) === k);
  }
  function add(d, opt) {
    if (!d) return false;
    if (has(d.i)) return false;
    const n = typeof noticeOf === "function" ? noticeOf(d) : null;
    state.apps.unshift({
      i: d.i, code: d.code || "", u: d.u || "", r: d.r || "", city: d.city || "",
      t: d.t || "", seats: d.n || 0, noticeId: (n && n.id) || d.src || "",
      noticeTitle: (n && n.title) || "", noticeUrl: (n && noticeUrl(n)) || "",
      at: new Date().toISOString(), status: (opt && opt.status) || "已投递", note: ""
    });
    persist();
    render();
    return true;
  }
  function addMany(list) {
    let n = 0;
    (list || []).forEach(d => { if (add(d)) n++; });
    return n;
  }
  function remove(i) {
    const k = appKey(i);
    state.apps = state.apps.filter(a => String(a.i) !== k);
    persist();
    render();
  }
  function setStatus(i, st) {
    const a = state.apps.filter(x => String(x.i) === appKey(i))[0];
    if (!a) return;
    a.status = st;
    persist();
    render();
  }

  /* ---------- 表单 ---------- */
  function hydrate() {
    FIELDS.forEach(([k]) => {
      const input = $("#" + fid(k));
      if (!input) return;
      const v = state.profile[k] || "";
      if (!v) return;
      /* 文件输入框不允许脚本赋值，只在旁边的提示里显示文件名 */
      if (input.type === "file") {
        const tip = $("#mResumeName");
        if (tip) tip.textContent = v;
        return;
      }
      if (!input.value) input.value = v;
    });
    const note = $("#mNote");
    if (note && state.profile.mNote) note.value = state.profile.mNote;
  }
  function fid(k) { return "m" + k.charAt(0).toUpperCase() + k.slice(1); }
  function collect() {
    const out = {};
    FIELDS.forEach(([k]) => {
      const input = $("#" + fid(k));
      if (!input) return;
      if (input.type === "file") return;          /* 文件名由 change 事件写进 profile */
      out[k] = String(input.value || "").trim();
    });
    const note = $("#mNote");
    out.mNote = note ? String(note.value || "").trim() : "";
    return out;
  }
  function saveProfile(quiet) {
    state.profile = Object.assign({}, state.profile, collect());
    state.savedAt = new Date().toLocaleString("zh-CN", { hour12: false });
    persist();
    paint();
    if (!quiet) toast(`资料已保存到本地，完整度 ${score()}%`);
    return score();
  }
  function resetProfile() {
    state.profile = {};
    state.savedAt = "";
    persist();
    FIELDS.forEach(([k]) => {
      const input = $("#" + fid(k));
      if (input && input.type !== "file") input.value = "";
    });
    const tip = $("#mResumeName");
    if (tip) tip.textContent = "未选择";
    const note = $("#mNote");
    if (note) note.value = "";
    paint();
    toast("资料已清空（投递记录保留）");
  }

  /* ---------- 渲染 ---------- */
  function fmtAt(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    const p = n => String(n).padStart(2, "0");
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function paint() {
    const sc = score();
    const scoreEl = $("#meScore");
    if (scoreEl) {
      scoreEl.innerHTML = "完整度 <b>" + sc + "%</b>";
      scoreEl.className = "score" + (sc >= 80 ? " ok" : sc >= 40 ? "" : " low");
      scoreEl.title = sc >= 80 ? "资料够完整，可以打印报名表了" : "还差一些：投递前把必填项补齐";
    }
    const savedAt = $("#meSavedAt");
    if (savedAt) savedAt.textContent = state.savedAt ? "上次保存 " + state.savedAt : "还没保存过";
    const cnt = $("#meAppCount");
    if (cnt) cnt.textContent = state.apps.length + " 条";
    renderApps();
    const btn = $("#mePrint");
    if (btn) btn.disabled = state.apps.length === 0;
  }
  function renderApps() {
    const box = $("#meAppList");
    if (!box) return;
    const empty = $("#meAppEmpty");
    if (empty) empty.hidden = state.apps.length > 0;
    box.innerHTML = state.apps.map(a => {
      return `<div class="me-app" data-app="${esc(a.i)}">
        <div class="ma-main">
          <div class="ma-title">${esc(a.u)}<span class="ma-role">${esc(a.r || a.code || "岗位")}</span></div>
          <div class="ma-meta">${esc(a.city || "—")} · ${esc(a.t || "—")} · 招 ${money(a.seats)} 人</div>
          <div class="ma-time">投递于 ${esc(fmtAt(a.at))}${a.noticeTitle ? ` · <a class="lnk" href="${esc(a.noticeUrl)}" target="_blank" rel="noopener">${esc(a.noticeTitle)}</a>` : ""}</div>
        </div>
        <div class="ma-status">
          <select class="ma-sel" data-mstatus="${esc(a.i)}" aria-label="${esc(a.u)} ${esc(a.r)} 的投递状态">
            ${APP_STATUS.map(s => `<option${s === a.status ? " selected" : ""}>${esc(s)}</option>`).join("")}
          </select>
        </div>
        <div class="ma-op">
          <button class="go" data-mview="${esc(a.i)}">看岗位</button>
          <button class="go" data-mdel="${esc(a.i)}" aria-label="删除这条投递">删除</button>
        </div>
      </div>`;
    }).join("");
  }

  /* ---------- 导出 / 打印 ---------- */
  function exportCsv() {
    if (!state.apps.length) { toast("还没有投递记录"); return; }
    const p = state.profile;
    const n = csvDownload(
      ["岗位代码", "单位", "岗位", "地区", "性质", "名额", "来源公告", "投递时间", "状态", "备注", "姓名", "手机", "邮箱", "学历", "学位", "专业", "毕业院校", "毕业时间"],
      state.apps.map(a => [a.code, a.u, a.r, a.city, a.t, a.seats, a.noticeTitle, a.at, a.status, a.note,
        p.name || "", p.phone || "", p.email || "", p.edu || "", p.degree || "", p.major || "", p.school || "", p.grad || ""]),
      `starta-我的投递-${state.apps.length}条.csv`
    );
    toast(`已导出 ${n} 条投递记录`);
  }
  function buildPrintSheet() {
    const p = state.profile;
    const rows = FIELDS.map(([k, label]) => `<tr><th>${esc(label)}</th><td>${esc(p[k] || "—")}</td></tr>`).join("")
      + `<tr><th>备注</th><td>${esc(p.mNote || "—")}</td></tr>`;
    const apps = state.apps.length
      ? state.apps.map((a, idx) => `<tr><td>${idx + 1}</td><td>${esc(a.u)}</td><td>${esc(a.r || a.code || "—")}</td><td>${esc(a.city)}</td><td>${esc(a.status)}</td><td>${esc(fmtAt(a.at))}</td></tr>`).join("")
      : `<tr><td colspan="6">还没有投递记录</td></tr>`;
    const box = $("#printSheet");
    if (!box) return;
    box.innerHTML = `<div class="ps-hd"><h1>报名信息表</h1><p>星他 · 招聘情报台 · 打印于 ${esc(new Date().toLocaleString("zh-CN", { hour12: false }))}</p></div>
      <h2>个人信息</h2><table class="ps-kv">${rows}</table>
      <h2>投递记录（${state.apps.length}）</h2>
      <table class="ps-apps"><thead><tr><th>#</th><th>单位</th><th>岗位</th><th>地区</th><th>状态</th><th>投递时间</th></tr></thead><tbody>${apps}</tbody></table>
      <p class="ps-ft">本表由浏览器本地生成，仅作报名资料整理；正式报名请到公告指定的报名系统提交。</p>`;
  }
  function print() {
    saveProfile(true);
    buildPrintSheet();
    document.body.classList.add("printing");
    window.print();
    setTimeout(() => document.body.classList.remove("printing"), 400);
  }

  /* ---------- 事件 ---------- */
  function bind() {
    const res = $("#mResume");
    if (res) {
      res.addEventListener("change", () => {
        const f = res.files && res.files[0];
        state.profile.resume = f ? f.name : "";
        const nm = $("#mResumeName");
        if (nm) nm.textContent = f ? f.name : "未选择";
        persist();
        paint();
      });
    }
    const form = $("#meForm");
    if (form) {
      form.addEventListener("input", () => { saveProfile(true); });
      form.addEventListener("change", () => { saveProfile(true); });
    }
    const save = $("#meSave");
    if (save) save.addEventListener("click", () => saveProfile(false));
    const reset = $("#meReset");
    if (reset) reset.addEventListener("click", resetProfile);
    const exp = $("#meExport");
    if (exp) exp.addEventListener("click", exportCsv);
    const pr = $("#mePrint");
    if (pr) pr.addEventListener("click", print);
    const list = $("#meAppList");
    if (list) {
      list.addEventListener("click", e => {
        const del = e.target.closest("[data-mdel]");
        if (del) {
          const i = del.dataset.mdel;
          const a = state.apps.filter(x => String(x.i) === String(i))[0];
          remove(i);
          toast(a ? `已删除「${a.u} ${a.r}」的投递` : "已删除");
          return;
        }
        const view = e.target.closest("[data-mview]");
        if (view) {
          const i = Number(view.dataset.mview);
          if (typeof openDrawer === "function") openDrawer(i, view);
        }
      });
      list.addEventListener("change", e => {
        const sel = e.target.closest("[data-mstatus]");
        if (!sel) return;
        setStatus(sel.dataset.mstatus, sel.value);
        toast("状态已更新：" + sel.value);
      });
    }
  }

  function render() {
    if (!hydrated) { hydrate(); hydrated = true; }
    paint();
    if (typeof syncStatusText === "function") syncStatusText();
  }

  let inited = false;
  function init() {
    if (inited || !document.getElementById("view-me")) return;
    inited = true;
    bind();
    hydrate();
    hydrated = true;
    paint();
  }

  document.addEventListener("DOMContentLoaded", init);
  if (document.readyState !== "loading") init();

  return { count, score, has, add, addMany, remove, setStatus, render, exportCsv, print, saveProfile, resetProfile, buildPrintSheet, list: () => state.apps.slice() };
})();
