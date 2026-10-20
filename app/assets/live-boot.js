/* 星他 · 实时数据层（工作台引导）
 * 只在浏览器里跑：Live 组件统一负责 状态徽标 / 秒级时钟 / 相对时间 / 倒计时 / 数字滚动。
 * 数据本身是真实的：KPI 来自 window.STARTA，截止时间来自公告原文，绝不在前端编造数字。
 */
(function () {
  "use strict";
  if (!window.Live) return;

  /* 采集时间的真实精度：能拿到 ISO 时间戳就用它（到分钟），只有日期才退回日期 */
  var LIVE_COLLECT = (window.STARTA && window.STARTA.COLLECT) || null;
  var LIVE_ASOF = (LIVE_COLLECT && LIVE_COLLECT.at) || (window.STARTA && window.STARTA.collectedAt) || "";
  var started = false;

  function $(sel) { return document.querySelector(sel); }

  function earliestDeadline() {
    var notices = (window.STARTA && window.STARTA.NOTICES) || [];
    var best = null;
    for (var i = 0; i < notices.length; i++) {
      var n = notices[i];
      if (!n || !n.open) continue;
      var t = Live.toDate(n.end);
      if (isFinite(t) && (best === null || t < best)) best = t;
    }
    return best;
  }

  /* 首屏：KPI 从 0 数到真值（页面里本来就有数字，只是让变化被看见） */
  function bumpCounts() {
    ["#kpiOpen", "#kpiWeekNew", "#kpiUnits", "#kpiTypes", "#kpiUrgent", "#kpiSaved"].forEach(function (sel) {
      var node = $(sel);
      if (!node) return;
      var text = (node.textContent || "").replace(/[^\d]/g, "");
      if (!text) return;
      var target = Number(text);
      if (!isFinite(target)) return;
      Live.num(node, target, { from: 0, decimals: 0 });
    });
  }

  function flashPill(ok) {
    var pill = document.getElementById("livePill");
    if (!pill) return;
    pill.classList.add(ok ? "live-flash" : "live-flash-warn");
    setTimeout(function () {
      /* 分开 remove：IE11 的 DOMTokenList.remove 只吃一个参数，多参会抛错 */
      pill.classList.remove("live-flash");
      pill.classList.remove("live-flash-warn");
    }, 1200);
  }

  /* 另一个标签页（同源打开的工作台/双端）改了本地存储：这边立刻跟着变 */
  function watchOtherTabs() {
    window.addEventListener("storage", function (e) {
      if (!e || e.key !== "starta-wb-bench") return;
      try {
        var before = (typeof state !== "undefined" && state.saved) ? state.saved.size : 0;
        if (typeof restoreSaved === "function") restoreSaved();
        var after = (typeof state !== "undefined" && state.saved) ? state.saved.size : 0;
        if (typeof syncKPI === "function") syncKPI();
        if (typeof render === "function") render();
        if (typeof renderCitems === "function") renderCitems();
        if (typeof renderCinfo === "function") renderCinfo();
        if (typeof syncStatusText === "function") syncStatusText();
        if (after !== before) Live.delta("#kpiSaved", after - before);
        flashPill(true);
        if (typeof toast === "function") {
          toast(after > before
            ? "另一标签页新增对标 · 现在 " + after + " 条"
            : "另一标签页减了对标 · 现在 " + after + " 条");
        }
      } catch (err) { /* 页面结构变了也不该把工作台弄挂 */ }
    });
  }

  function start() {
    if (started) return;
    started = true;

    Live.init({
      channel: "starta-live",
      pill: "#livePill",
      asOf: LIVE_ASOF,
      tabLabel: "情报台"
    });

    /* 数据截至：优先用服务端真实扫描时间（CSV 写入时间），退回页面自带的采集日
       只拿到“2026-10-20”这种日期时，不编造小时，明说是当天快照 */
    if (LIVE_ASOF) {
      Live.ago("#liveAsOf", function () {
        var st = window.Live.state && window.Live.state();
        if (st && st.asOf) return st.asOf;
        return /T\d{2}:\d{2}/.test(LIVE_ASOF) ? Live.toDate(LIVE_ASOF) : null;
      }, { prefix: "数据截至 ", emptyText: "数据截至 " + LIVE_ASOF + " 快照" });
    }

    /* 真实截止时间：最近一个仍开放公告的报名截止 */
    var dl = earliestDeadline();
    if (dl) Live.countdown("#kpiCd", dl, { prefix: " · 剩 ", expiredText: " · 已截止" });

    bumpCounts();
    watchOtherTabs();

    /* 服务端数据文件真变了（SSE 的 data 事件）：如实提示，不自动改页面数字 */
    Live.on("data", function (ev) {
      var t = (ev && ev.totals) || {};
      if (typeof toast === "function" && t.positions) {
        toast("服务端数据文件有更新：" + Live.fmt(t.positions) + " 行岗位 · 刷新页面按新数据重算");
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
