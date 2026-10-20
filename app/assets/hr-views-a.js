/* =====================================================================
   星他 STARTA · 招聘执行视图（v1.1）
   ---------------------------------------------------------------------
   本文件注册两个视图：
     jd     —— 我的职位：JD 实体、薪资/编制、门槛差距、状态流转
     talent —— 人才库：候选人漏斗、CSV 导入导出、岗位关联、初筛推进

   只依赖 window.HR（hr-core.js）与 window.STARTA（data.js），
   不往全局泄露任何符号。
   ===================================================================== */
(function () {
  "use strict";

  var HR = window.HR;
  if (!HR) { console.error("[HR] hr-core.js 还没加载，招聘执行视图无法注册"); return; }
  var esc = HR.esc, fmt = HR.fmt, q = HR.q, qa = HR.qa;

  var JD_KEY_DONE = false;

  /* ---------------- 小工具 ---------------- */
  function $(sel) { return q(sel); }
  function num(v) {
    var n = Number(v);
    return isFinite(n) && n > 0 ? n : 0;
  }
  function chips(arr, empty) {
    if (!arr.length) return '<span class="hrmuted">' + esc(empty || "无") + "</span>";
    return arr.map(function (x) { return '<span class="chip">' + esc(x) + "</span>"; }).join("");
  }
  function field(label, inner, hint) {
    return '<label class="fld"><span>' + esc(label) + "</span>" + inner + (hint ? "<small>" + esc(hint) + "</small>" : "") + "</label>";
  }
  function input(name, value, attrs) {
    return '<input name="' + esc(name) + '" value="' + esc(value == null ? "" : value) + '" ' + (attrs || "") + ">";
  }
  function select(name, options, value) {
    return '<select name="' + esc(name) + '">' + options.map(function (o) {
      var v = typeof o === "object" ? o.v : o;
      var lb = typeof o === "object" ? o.lb : o;
      return '<option value="' + esc(v) + '"' + (String(v) === String(value) ? " selected" : "") + ">" + esc(lb) + "</option>";
    }).join("") + "</select>";
  }
  function jdStatusChip(status) {
    var s = HR.jdStatus[status] || HR.jdStatus.draft;
    return '<span class="stpill' + (s.tone ? " " + s.tone : "") + '" data-st="' + esc(status) + '">' + esc(s.lb) + "</span>";
  }
  function gapBadge(level) {
    var lb = level === "high" ? "门槛偏高" : level === "watch" ? "需要关注" : "基本合理";
    return '<i class="hrgap-lv ' + esc(level) + '">' + esc(lb) + "</i>";
  }
  function stageLabel(k) {
    var s = HR.stages.filter(function (x) { return x.k === k; })[0];
    return s ? s.lb : k;
  }
  function readVal(el) {
    if (!el) return "";
    return String(el.value == null ? "" : el.value).trim();
  }
  function formVals(wrap) {
    var m = {};
    wrap.querySelectorAll("[name]").forEach(function (el) { m[el.getAttribute("name")] = readVal(el); });
    return m;
  }
  function err(wrap, msg) {
    var e = wrap.querySelector("[data-err]");
    if (e) { e.textContent = msg; }
    HR.toast(msg);
  }
  function jobOptions(selected) {
    var list = HR.jd.list();
    return [{ v: "", lb: list.length ? "不关联职位" : "还没有职位，先到「我的职位」新建" }].concat(list.map(function (j) {
      return { v: j.id, lb: j.title + (j.status === "live" ? "" : "（草稿）") };
    }));
  }

  /* =====================================================================
     JD 表单
     ===================================================================== */
  var EDU_OPTS = ["不限", "高中/中专", "专科", "本科", "硕士", "博士"];
  var EXP_OPTS = ["不限", "应届/无经验", "1 年以内", "1–3 年", "3–5 年", "5 年以上"];
  var TYPE_OPTS = ["事业单位", "国企"];

  function jdFormHTML(j, source) {
    var v = j || {};
    var src = source || null;
    var srcNote = src
      ? '<p class="hrform-note">' + HR.icon("list", 13) + " 已从市场岗位表预填：" + esc(src.u) + " · " + esc(src.r) + "（仅作起草底稿，发布前请改成你的真实口径）</p>"
      : "";
    return srcNote +
      '<div class="hrform">' +
        field("职位名称 *", input("title", v.title || (src ? src.r : ""), 'maxlength="60" placeholder="例如：林学专业技术岗"'), "对外发布时展示的名字") +
        '<div class="hrform-row">' +
          field("用人部门", input("dept", v.dept || (src ? src.dept : ""), 'maxlength="40" placeholder="例如：林业技术推广中心"')) +
          field("职级", input("level", v.level || "", 'maxlength="30" placeholder="例如：专技十二级"')) +
        "</div>" +
        '<div class="hrform-row">' +
          field("工作城市", input("city", v.city || (src ? src.city : HR.profile().city), 'maxlength="30"')) +
          field("单位性质", select("type", TYPE_OPTS, v.type || (src ? src.t : "事业单位"))) +
        "</div>" +
        '<div class="hrform-row">' +
          field("学历要求", select("edu", EDU_OPTS, v.edu || (src ? src.e : "本科"))) +
          field("经验要求", select("exp", EXP_OPTS, v.exp || (src ? src.x : "不限"))) +
        "</div>" +
        field("专业要求", input("major", v.major || (src ? src.m : ""), 'maxlength="120" placeholder="多个专业用、分隔，例如：林学、森林保护"')) +
        '<div class="hrform-row three">' +
          field("招聘人数", input("headcount", v.headcount == null ? (src ? src.n : 1) : v.headcount, 'type="number" min="1" max="9999"')) +
          field("薪资下限（元/月）", input("salaryMin", v.salaryMin == null ? "" : v.salaryMin, 'type="number" min="0" step="100" placeholder="选填"')) +
          field("薪资上限（元/月）", input("salaryMax", v.salaryMax == null ? "" : v.salaryMax, 'type="number" min="0" step="100" placeholder="选填"')) +
        "</div>" +
        field("岗位职责", '<textarea name="responsibilities" rows="3" maxlength="1200" placeholder="写清做什么、汇报给谁、考核口径">' + esc(v.responsibilities || "") + "</textarea>") +
        field("任职要求", '<textarea name="requirements" rows="3" maxlength="1200" placeholder="学历、专业、证书、能力项">' + esc(v.requirements || "") + "</textarea>") +
        field("状态", select("status", (function () {
          var opts = [{ v: "draft", lb: "草稿（不参与差距核算展示）" }, { v: "live", lb: "在招（进提醒与简报）" }];
          if (v.status === "closed") opts.push({ v: "closed", lb: "已关闭（保留历史口径）" });
          return opts;
        })(), v.status || "draft")) +
      "</div>" +
      (v.versions && v.versions.length
        ? '<div class="hrversions"><b>版本记录</b><ul>' + v.versions.slice(-5).reverse().map(function (x) {
            return "<li><span>" + esc(x.at) + "</span>" + esc(x.note || "") + "<em>" + esc(x.by || "") + "</em></li>";
          }).join("") + "</ul></div>"
        : "");
  }

  function openJdForm(j, source) {
    if (!HR.canWrite()) { HR.toast("当前角色只读，切到「招聘负责人」再建职位"); return; }
    var isEdit = !!j;
    var m = HR.modal({
      title: isEdit ? "编辑职位" : "新建职位",
      sub: isEdit ? j.title : (source ? "基于市场岗位起草" : "先建 JD，差距和提醒才会启动"),
      wide: true,
      body: jdFormHTML(j, source),
      okText: isEdit ? "保存修改" : "创建职位",
      onOk: function (wrap) {
        var f = formVals(wrap);
        if (!f.title) { err(wrap, "职位名称不能为空"); return false; }
        if (f.salaryMin && f.salaryMax && Number(f.salaryMin) > Number(f.salaryMax)) { err(wrap, "薪资下限不能高于上限"); return false; }
        var payload = {
          title: f.title, dept: f.dept, level: f.level, city: f.city, type: f.type,
          edu: f.edu, exp: f.exp, major: f.major,
          headcount: f.headcount, salaryMin: f.salaryMin, salaryMax: f.salaryMax,
          responsibilities: f.responsibilities, requirements: f.requirements, status: f.status
        };
        if (isEdit) {
          HR.jd.update(j.id, payload);
          HR.toast("职位已更新");
        } else {
          if (source) payload.sourceJobId = source.i;
          var created = HR.jd.add(payload);
          if (!created) return false;
          HR.toast("职位已创建" + (created.status === "live" ? " · 已在招" : " · 存为草稿"));
        }
        HR.refreshBell();
        renderJd(document.getElementById("view-jd"));
        return true;
      }
    });
    return m;
  }

  /* ---------------- JD 视图 ---------------- */
  function jdCard(j, ro) {
    ro = ro || "";
    var g = null;
    try { g = HR.market && HR.market.gap ? HR.market.gap(j) : null; } catch (e) { g = null; }
    var meta = [j.dept, j.city, j.type, j.level].filter(Boolean).map(esc).join(" · ");
    var salText = "";
    if (j.salaryMin && j.salaryMax) salText = fmt(j.salaryMin) + " – " + fmt(j.salaryMax) + " 元/月";
    else if (j.salaryMin) salText = fmt(j.salaryMin) + " 元/月起";
    else if (j.salaryMax) salText = "最高 " + fmt(j.salaryMax) + " 元/月";
    var salary = salText ? salText + " · " + (j.months || 12) + " 薪" : '<span class="hrmuted">薪资未填</span>';
    var headcount = j.headcount ? "招 " + j.headcount + " 人" : "人数未填";
    return '<article class="hjdcard' + (j.status === "closed" ? " is-closed" : "") + '" data-jd="' + esc(j.id) + '">' +
      '<header class="hjdcard-hd"><div><h3>' + esc(j.title) + "</h3><p>" + (meta || "部门 / 城市待补") + "</p></div>" + jdStatusChip(j.status) + "</header>" +
      '<div class="hjdcard-facts">' +
        '<span><b>学历</b>' + esc(j.edu || "不限") + "</span>" +
        '<span><b>经验</b>' + esc(j.exp || "不限") + "</span>" +
        '<span><b>专业</b>' + esc(j.major || "不限") + "</span>" +
        '<span><b>编制</b>' + esc(headcount) + "</span>" +
        '<span class="wide"><b>薪资</b>' + salary + "</span>" +
      "</div>" +
      (g ? '<div class="hrgap ' + esc(g.level) + '">' +
        '<div class="hrgap-hd">' + gapBadge(g.level) + '<span>市场同类 ' + fmt(g.sample) + " 条</span>" +
          '<button type="button" class="hlink" data-hr-act="jd-bench" data-id="' + esc(j.id) + '">看市场分布 →</button></div>' +
        '<p class="hrgap-sum">' + esc(g.summary) + "</p>" +
        (g.flags.length > 1 ? '<ul class="hrgap-flags">' + g.flags.slice(1).map(function (f) { return "<li>" + esc(f) + "</li>"; }).join("") + "</ul>" : "") +
      "</div>" : "") +
      '<footer class="hjdcard-ft">' +
        '<button type="button" class="btn ghost" data-hr-act="jd-edit" data-id="' + esc(j.id) + '"' + ro + '>编辑</button>' +
        (j.status !== "closed" ? '<button type="button" class="btn ghost" data-hr-act="jd-status" data-id="' + esc(j.id) + '" data-st="' + (j.status === "live" ? "draft" : "live") + '"' + ro + '>' + (j.status === "live" ? "暂停招聘" : "发布在招") + "</button>" : '<button type="button" class="btn ghost" data-hr-act="jd-status" data-id="' + esc(j.id) + '" data-st="live"' + ro + '>重新开启</button>') +
        '<button type="button" class="btn ghost" data-hr-act="jd-copy" data-id="' + esc(j.id) + '">复制 JD</button>' +
        '<button type="button" class="btn ghost danger" data-hr-act="jd-del" data-id="' + esc(j.id) + '"' + ro + '>删除</button>' +
        '<small class="hrmeta">更新于 ' + esc(j.updated || j.created || "") + "</small>" +
      "</footer></article>";
  }

  function renderJd(page) {
    if (!page) return;
    var list = HR.jd.list();
    var live = list.filter(function (j) { return j.status === "live"; }).length;
    var drafts = list.filter(function (j) { return j.status === "draft"; }).length;
    var closed = list.filter(function (j) { return j.status === "closed"; }).length;

    var ro = HR.canWrite() ? "" : ' disabled title="只读角色：切换到「招聘负责人」后可编辑"';
    var head = '<div class="page-head"><div><h1>我的职位</h1><p class="sub">你自己的 JD 实体。建得越像真实口径，门槛差距和对标简报越准。</p></div>' +
      '<div class="head-side"><button type="button" class="btn ghost" data-hr-act="jd-from-market"' + ro + ">从市场岗位起草</button>" +
      '<button type="button" class="btn primary" data-hr-act="jd-new"' + ro + ">新建职位</button></div></div>";

    var kpis = '<div class="kpis four">' +
      '<div class="kpi"><span>职位总数</span><b>' + list.length + "</b><small>草稿 " + drafts + " 个</small></div>" +
      '<div class="kpi"><span>在招</span><b>' + live + '</b><small>进提醒与简报</small></div>' +
      '<div class="kpi"><span>已关闭</span><b>' + closed + "</b><small>保留历史口径</small></div>" +
      '<div class="kpi"><span>候选人</span><b>' + HR.talent.list().length + "</b><small>待初筛 " + HR.talent.list().filter(function (t) { return t.stage === "new"; }).length + " 人</small></div>" +
      "</div>";

    var body;
    if (!list.length) {
      body = '<div class="panel hrempty-panel"><div class="hr-empty">' + HR.icon("doc", 26) +
        "<b>还没有职位</b><span>两条路：直接新建 JD，或从市场岗位库里挑一条同类岗位起草（会预填学历、专业、人数口径）。</span>" +
        '<div class="hr-empty-act"><button type="button" class="btn primary" data-hr-act="jd-new"' + ro + ">新建职位</button>" +
        '<button type="button" class="btn ghost" data-hr-act="jd-from-market"' + ro + ">从市场起草</button></div></div></div>";
    } else {
      var sorted = list.slice().sort(function (a, b) {
        var rank = { live: 0, draft: 1, closed: 2 };
        return (rank[a.status] - rank[b.status]) || String(b.updated || "").localeCompare(String(a.updated || ""));
      });
      body = '<div class="hjdlist">' + sorted.map(function (j) { return jdCard(j, ro); }).join("") + "</div>";
    }

    var rolesHint = HR.canWrite() ? "" :
      '<div class="callout warn">当前身份「' + esc(HR.role().lb) + "」为只读/受限角色，建职位、改状态会被拦截。点左下角头像切换角色。</div>";

    page.innerHTML = head + rolesHint + kpis + body;
    bindJd(page);
  }

  function bindJd(page) {
    if (page.__hrBoundJd) return;
    page.__hrBoundJd = true;
    page.addEventListener("click", function (e) {
      var b = e.target.closest("[data-hr-act]");
      if (!b) return;
      var act = b.getAttribute("data-hr-act");
      var id = b.getAttribute("data-id");
      if (act === "jd-new") { e.preventDefault(); openJdForm(null, null); return; }
      if (act === "jd-edit") { e.preventDefault(); var j = HR.jd.get(id); if (j) openJdForm(j, null); return; }
      if (act === "jd-from-market") { e.preventDefault(); openMarketPicker(); return; }
      if (act === "jd-status") {
        e.preventDefault();
        var jj = HR.jd.get(id);
        if (!jj) return;
        var st = b.getAttribute("data-st");
        if (!HR.jd.setStatus(id, st)) return;   /* 只读角色：requireWrite 已提示，别再报成功 */
        HR.toast("「" + jj.title + "」→ " + (HR.jdStatus[st] || {}).lb);
        renderJd(page);
        return;
      }
      if (act === "jd-del") {
        e.preventDefault();
        var jx = HR.jd.get(id);
        if (!jx) return;
        HR.confirm("删除职位", "将删除「" + jx.title + "」及其版本记录，候选人关联不受影响。确定？", function () {
          if (!HR.jd.remove(id)) return;   /* 只读角色：不能假装删除成功 */
          HR.toast("职位已删除");
          renderJd(page);
        }, "删除");
        return;
      }
      if (act === "jd-copy") {
        e.preventDefault();
        var jy = HR.jd.get(id);
        if (!jy) return;
        var text = jdPlainText(jy);
        HR.copyText(text).then(function (ok) {
          HR.toast(ok ? "JD 文案已复制" : "复制失败，请手动选择文本");
        });
        return;
      }
      if (act === "jd-bench") {
        e.preventDefault();
        var jz = HR.jd.get(id);
        if (jz) HR.setView("brief");
        return;
      }
    });
  }

  function jdPlainText(j) {
    var L = [];
    L.push(j.title + (j.dept ? " · " + j.dept : ""));
    L.push("");
    L.push("工作城市：" + (j.city || "—"));
    L.push("单位性质：" + (j.type || "—"));
    L.push("学历要求：" + (j.edu || "不限"));
    L.push("经验要求：" + (j.exp || "不限"));
    L.push("专业要求：" + (j.major || "不限"));
    L.push("招聘人数：" + (j.headcount || 1) + " 人");
    if (j.salaryMin && j.salaryMax) L.push("薪资范围：" + fmt(j.salaryMin) + " – " + fmt(j.salaryMax) + " 元/月 · " + (j.months || 12) + " 薪");
    else if (j.salaryMin) L.push("薪资下限：" + fmt(j.salaryMin) + " 元/月起 · " + (j.months || 12) + " 薪");
    if (j.responsibilities) { L.push(""); L.push("【岗位职责】"); L.push(j.responsibilities); }
    if (j.requirements) { L.push(""); L.push("【任职要求】"); L.push(j.requirements); }
    L.push("");
    L.push("—— 星他 STARTA 招聘情报台");
    return L.join("\n");
  }

  /* 从市场岗位起草：搜索真实岗位表，点一条进 JD 表单 */
  function openMarketPicker() {
    if (!HR.canWrite()) { HR.toast("当前角色只读"); return; }
    var m = HR.modal({
      title: "从市场岗位起草",
      sub: "搜索 9,200 条真实岗位表里的同类岗位，选中后预填成你的 JD 草稿",
      wide: true,
      okText: "关闭",
      body: '<div class="hrmp-search">' + HR.icon("search", 14) +
        '<input id="hrmpQ" type="search" placeholder="输入单位、岗位、专业关键词，例如：林学 / 广州 / 林业局" autocomplete="off">' +
        '<span class="hrmuted" id="hrmpCount">输入关键词后回车</span></div>' +
        '<div class="hrmp-list" id="hrmpList"><div class="hr-empty small">' + HR.icon("search", 20) + "<b>先搜一个词</b><span>会从快照里取最接近的 12 条岗位。</span></div></div>",
      onOk: function () { return true; }
    });
    var wrap = m.el;
    var qEl = wrap.querySelector("#hrmpQ");
    var listEl = wrap.querySelector("#hrmpList");
    var countEl = wrap.querySelector("#hrmpCount");
    function search() {
      var kw = String(qEl.value || "").trim().toLowerCase();
      var pool = HR.positions();
      var hits = pool;
      if (kw) {
        var parts = kw.split(/\s+/);
        hits = pool.filter(function (d) {
          var hay = (d.u + " " + d.r + " " + d.m + " " + d.city + " " + d.code + " " + d.dept).toLowerCase();
          return parts.every(function (p) { return hay.indexOf(p) >= 0; });
        });
      }
      hits = hits.slice(0, 12);
      countEl.textContent = kw ? "命中 " + fmt(hits.length) + " 条（取前 12）" : "全部 " + fmt(pool.length) + " 条（取前 12）";
      if (!hits.length) {
        listEl.innerHTML = '<div class="hr-empty small"><b>没搜到</b><span>换个更短的关键词，例如只写专业或城市。</span></div>';
        return;
      }
      listEl.innerHTML = hits.map(function (d) {
        return '<button type="button" class="hrmp-item" data-src="' + esc(d.i) + '">' +
          '<div class="hrmp-main"><b>' + esc(d.r) + "</b><small>" + esc(d.u) + (d.dept ? " · " + esc(d.dept) : "") + "</small></div>" +
          '<div class="hrmp-meta"><span>' + esc(d.city || "") + "</span><span>" + esc(d.t || "") + "</span><span>" + esc(d.e || "") + "</span><span>招 " + esc(d.n) + "</span></div>" +
          '<span class="hrmp-go">' + HR.icon("arrow", 14) + "</span></button>";
      }).join("");
    }
    qEl.addEventListener("input", search);
    qEl.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); search(); } });
    listEl.addEventListener("click", function (e) {
      var b = e.target.closest("[data-src]");
      if (!b) return;
      var src = HR.posById(Number(b.getAttribute("data-src")));
      if (!src) return;
      m.close();
      setTimeout(function () { openJdForm(null, src); }, 30);
    });
    search();
    setTimeout(function () { qEl.focus(); }, 40);
  }

  HR.views.jd = renderJd;
  HR.views.focusJd = function (id) {
    var j = HR.jd.get(String(id || ""));
    if (j) openJdForm(j, null);
  };
  HR.views.draftFrom = function (sourceId) {
    var src = HR.posById(Number(sourceId));
    if (src) { HR.setView("jd"); setTimeout(function () { openJdForm(null, src); }, 60); }
  };

  /* =====================================================================
     人才库
     ===================================================================== */
  function openTalentForm(t) {
    if (!t && !HR.canWrite()) { HR.toast("当前角色只读"); return; }
    var isEdit = !!t;
    var v = t || {};
    var m = HR.modal({
      title: isEdit ? "编辑候选人" : "新增候选人",
      sub: "手机号 + 关联职位作为去重键",
      wide: false,
      body: '<div class="hrform">' +
        field("姓名 *", input("name", v.name || "", 'maxlength="30" placeholder="候选人姓名"')) +
        '<div class="hrform-row">' +
          field("手机", input("phone", v.phone || "", 'maxlength="20" inputmode="tel"')) +
          field("邮箱", input("email", v.email || "", 'maxlength="60" inputmode="email"')) +
        "</div>" +
        '<div class="hrform-row">' +
          field("来源", select("source", ["手动录入", "招聘网站", "内推", "校招", "猎头", "CSV 导入", "其他"], v.source || "手动录入")) +
          field("关联职位", select("jobId", jobOptions(v.jobId), v.jobId || "")) +
        "</div>" +
        field("阶段", select("stage", HR.stages.map(function (s) { return { v: s.k, lb: s.lb }; }), v.stage || "new")) +
        field("备注", '<textarea name="note" rows="3" maxlength="800" placeholder="面试反馈、薪资期望、到岗时间">' + esc(v.note || "") + "</textarea>") +
        (isEdit ? '<p class="hrform-note">创建于 ' + esc(v.created || "") + " · 最近更新 " + esc(v.updated || "") + "</p>" : "") +
        "</div>",
      okText: isEdit ? "保存" : "添加",
      onOk: function (wrap) {
        var f = formVals(wrap);
        if (!f.name) { err(wrap, "姓名不能为空"); return false; }
        if (f.phone && !/^[0-9+\-\s()]{6,20}$/.test(f.phone)) { err(wrap, "手机号格式看起来不对"); return false; }
        if (isEdit) {
          HR.talent.update(t.id, f);
          HR.toast("候选人已更新");
        } else {
          var created = HR.talent.add(f);
          if (!created) return false;
          HR.toast("已添加候选人");
        }
        HR.refreshBell();
        renderTalent(document.getElementById("view-talent"));
        return true;
      }
    });
    return m;
  }

  function openTalentDetail(id) {
    var t = HR.talent.get(id);
    if (!t) return;
    var noteAllowed = HR.canNote();
    var m = HR.modal({
      title: t.name,
      sub: (t.jobTitle || "未关联职位") + " · 来源 " + (t.source || "—"),
      body: '<div class="hrform">' +
        '<div class="hrform-row">' + field("手机", '<div class="hrmodal-msg">' + esc(t.phone || "—") + "</div>") + field("邮箱", '<div class="hrmodal-msg">' + esc(t.email || "—") + "</div>") + "</div>" +
        field("阶段", '<div class="hrstage-pills">' + HR.stages.map(function (s) {
          return '<button type="button" class="stchip' + (s.k === t.stage ? " on" : "") + '" data-hr-stage="' + s.k + '"' + (noteAllowed ? "" : " disabled") + ">" + esc(s.lb) + "</button>";
        }).join("") + "</div>") +
        field("备注", '<textarea name="note" rows="4" ' + (noteAllowed ? "" : "disabled") + ' maxlength="800" placeholder="面试反馈、薪资期望、到岗时间">' + esc(t.note || "") + "</textarea>") +
        '<p class="hrform-note">创建 ' + esc(t.created || "") + " · 更新 " + esc(t.updated || "") + "</p></div>",
      okText: "保存",
      onOk: function (wrap) {
        if (!noteAllowed) { HR.toast("当前角色只能查看"); return false; }
        HR.talent.update(id, { note: formVals(wrap).note });
        HR.toast("已保存");
        renderTalent(document.getElementById("view-talent"));
        return true;
      }
    });
    m.el.addEventListener("click", function (e) {
      var b = e.target.closest("[data-hr-stage]");
      if (!b || !noteAllowed) return;
      HR.talent.update(id, { stage: b.getAttribute("data-hr-stage") });
      m.el.querySelectorAll("[data-hr-stage]").forEach(function (x) { x.classList.toggle("on", x === b); });
      HR.toast("阶段已推进到「" + stageLabel(b.getAttribute("data-hr-stage")) + "」");
      HR.refreshBell();
    });
  }

  function talentFunnel(list) {
    var counts = HR.stages.map(function (s) {
      return { k: s.k, lb: s.lb, v: list.filter(function (t) { return t.stage === s.k; }).length };
    });
    var max = Math.max.apply(null, counts.map(function (c) { return c.v; })) || 1;
    return '<div class="hrfunnel">' + counts.map(function (c) {
      return '<div class="hrfunnel-col' + (c.v ? "" : " is-zero") + '">' +
        '<b>' + c.v + "</b><span>" + esc(c.lb) + "</span>" +
        '<i style="height:' + Math.max(4, Math.round(c.v / max * 54)) + 'px"></i></div>';
    }).join("") + "</div>";
  }

  function renderTalent(page) {
    if (!page) return;
    var list = HR.talent.list();
    var kw = (page.__hrTq || "").toLowerCase();
    var filter = page.__hrTstage || "";
    var shown = list.filter(function (t) {
      if (filter && t.stage !== filter) return false;
      if (!kw) return true;
      return (t.name + " " + t.phone + " " + t.email + " " + t.jobTitle + " " + t.source).toLowerCase().indexOf(kw) >= 0;
    });

    var ro = HR.canWrite() ? "" : ' disabled title="只读角色：切换到「招聘负责人」后可编辑"';
    var head = '<div class="page-head"><div><h1>人才库</h1><p class="sub">候选人从导入到 offer 的推进板。CSV 可对接招聘网站导出，手机号 + 岗位去重。</p></div>' +
      '<div class="head-side"><button type="button" class="btn ghost" data-hr-act="tal-import"' + ro + ">导入 CSV</button>" +
      '<button type="button" class="btn ghost" data-hr-act="tal-export" ' + (list.length ? "" : "disabled") + ">导出</button>" +
      '<button type="button" class="btn primary" data-hr-act="tal-new"' + ro + ">新增候选人</button></div></div>";

    var rolesHint = HR.canNote() ? "" :
      '<div class="callout warn">当前身份「' + esc(HR.role().lb) + "」不能改候选人阶段或备注，只能查看。点左下角头像切换。</div>";

    var kpis = '<div class="kpis four">' +
      '<div class="kpi"><span>候选人</span><b>' + list.length + "</b><small>已关联职位 " + list.filter(function (t) { return t.jobId; }).length + " 人</small></div>" +
      '<div class="kpi"><span>待初筛</span><b>' + list.filter(function (t) { return t.stage === "new"; }).length + '</b><small>今天先过一遍</small></div>' +
      '<div class="kpi"><span>推进中</span><b>' + list.filter(function (t) { return ["screen", "interview", "offer"].indexOf(t.stage) >= 0; }).length + '</b><small>初筛 / 面试 / offer</small></div>' +
      '<div class="kpi"><span>已入职</span><b>' + list.filter(function (t) { return t.stage === "hired"; }).length + "</b><small>转化率 " + (list.length ? Math.round(list.filter(function (t) { return t.stage === "hired"; }).length / list.length * 100) : 0) + "%</small></div>" +
      "</div>";

    var toolbar = '<div class="toolbar hrtoolbar">' +
      '<div class="hrsearch">' + HR.icon("search", 14) + '<input type="search" id="hrtalQ" placeholder="搜姓名、手机、岗位、来源" value="' + esc(page.__hrTq || "") + '" autocomplete="off"></div>' +
      '<div class="hrchips">' +
        '<button type="button" class="chip' + (filter ? "" : " on") + '" data-hr-stage-filter="">全部 ' + list.length + "</button>" +
        HR.stages.map(function (s) {
          var n = list.filter(function (t) { return t.stage === s.k; }).length;
          return '<button type="button" class="chip' + (filter === s.k ? " on" : "") + '" data-hr-stage-filter="' + s.k + '">' + esc(s.lb) + " " + n + "</button>";
        }).join("") +
      "</div></div>";

    var table;
    if (!list.length) {
      table = '<div class="panel hrempty-panel"><div class="hr-empty">' + HR.icon("user", 26) +
        "<b>人才库还是空的</b><span>三件事：CSV 导入（招聘网站导出的表头能自动识别）、手动加候选人、把候选人挂到职位上。</span>" +
        '<div class="hr-empty-act"><button type="button" class="btn primary" data-hr-act="tal-new"' + ro + ">新增候选人</button>" +
        '<button type="button" class="btn ghost" data-hr-act="tal-import"' + ro + ">导入 CSV</button></div></div></div>";
    } else if (!shown.length) {
      table = '<div class="panel"><div class="hr-empty small"><b>没有匹配的候选人</b><span>清掉筛选或换个关键词。</span></div></div>';
    } else {
      table = '<div class="panel hrtal-panel"><div class="hrtal-table">' +
        '<div class="hrtal-row head"><span>候选人</span><span>关联职位</span><span>来源</span><span>阶段</span><span>更新</span><span></span></div>' +
        shown.map(function (t) {
          var opts = HR.stages.map(function (s) {
            return '<option value="' + s.k + '"' + (s.k === t.stage ? " selected" : "") + ">" + esc(s.lb) + "</option>";
          }).join("");
          return '<div class="hrtal-row" data-tal="' + esc(t.id) + '">' +
            '<span class="hrtal-name"><button type="button" class="hlink" data-hr-act="tal-open" data-id="' + esc(t.id) + '"><b>' + esc(t.name) + "</b></button><small>" + esc(t.phone || t.email || "联系方式未填") + "</small></span>" +
            '<span>' + esc(t.jobTitle || "未关联") + "</span>" +
            '<span class="hrmuted">' + esc(t.source || "—") + "</span>" +
            '<span><select class="hrtal-stage" data-hr-act="tal-stage" data-id="' + esc(t.id) + '"' + (HR.canNote() ? "" : " disabled") + ">" + opts + "</select></span>" +
            '<span class="hrmuted">' + esc(t.updated || "") + "</span>" +
            '<span class="hrtal-act"><button type="button" class="icobtn" data-hr-act="tal-note" data-id="' + esc(t.id) + '" aria-label="备注" title="备注">' + HR.icon("edit", 14) + "</button>" +
            '<button type="button" class="icobtn" data-hr-act="tal-del" data-id="' + esc(t.id) + '" aria-label="删除" title="删除">' + HR.icon("trash", 14) + "</button></span>" +
            "</div>";
        }).join("") + "</div></div>";
    }

    var funnel = list.length ? '<div class="panel hrpanel"><div class="panel-hd"><b>招聘漏斗</b><span>阶段分布 · 颜色越深越靠后</span></div>' + talentFunnel(list) + "</div>" : "";

    page.innerHTML = head + rolesHint + kpis + toolbar + funnel + table;
    bindTalent(page);
  }

  function bindTalent(page) {
    if (page.__hrBoundTal) return;
    page.__hrBoundTal = true;
    page.addEventListener("input", function (e) {
      if (e.target.id === "hrtalQ") {
        page.__hrTq = e.target.value;
        var pos = e.target.selectionStart;
        renderTalent(page);
        var again = page.querySelector("#hrtalQ");
        if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (err) { /* ignore */ } }
      }
    });
    page.addEventListener("change", function (e) {
      var sel = e.target.closest("[data-hr-act='tal-stage']");
      if (!sel) return;
      if (!HR.canNote()) { HR.toast("当前角色不能改阶段"); renderTalent(page); return; }
      HR.talent.update(sel.getAttribute("data-id"), { stage: sel.value });
      HR.toast("阶段 → " + stageLabel(sel.value));
      HR.refreshBell();
      renderTalent(page);
    });
    page.addEventListener("click", function (e) {
      /* 阶段筛选 chip 没有 data-hr-act，必须在通用 action 守卫之前处理 */
      var f = e.target.closest("[data-hr-stage-filter]");
      if (f) {
        e.preventDefault();
        page.__hrTstage = f.getAttribute("data-hr-stage-filter") || "";
        renderTalent(page);
        return;
      }
      var b = e.target.closest("[data-hr-act]");
      if (!b) return;
      var act = b.getAttribute("data-hr-act");
      var id = b.getAttribute("data-id");
      if (act === "tal-new") { e.preventDefault(); openTalentForm(null); return; }
      if (act === "tal-open") { e.preventDefault(); openTalentDetail(id); return; }
      if (act === "tal-note") { e.preventDefault(); openTalentDetail(id); return; }
      if (act === "tal-stage") { /* change 已处理 */ return; }
      if (act === "tal-del") {
        e.preventDefault();
        var t = HR.talent.get(id);
        if (!t) return;
        HR.confirm("删除候选人", "将删除「" + t.name + "」，不可恢复。确定？", function () {
          HR.talent.remove(id);
          HR.toast("已删除");
          renderTalent(page);
        }, "删除");
        return;
      }
      if (act === "tal-export") {
        e.preventDefault();
        var csv = HR.talent.csv();
        HR.download("人才库_" + HR.isoDate(new Date()) + ".csv", "\uFEFF" + csv, "text/csv;charset=utf-8");
        HR.toast("已导出 " + HR.talent.list().length + " 人");
        return;
      }
      if (act === "tal-import") { e.preventDefault(); openImport(); return; }
    });
  }

  function openImport() {
    if (!HR.canWrite()) { HR.toast("当前角色只读，不能导入"); return; }
    var m = HR.modal({
      title: "导入候选人 CSV",
      sub: "支持姓名/手机/邮箱/来源/关联职位/备注表头；手机 + 职位去重",
      wide: false,
      okText: "导入",
      body: '<div class="hrform">' +
        field("选择文件", '<input type="file" id="hrimpFile" accept=".csv,text/csv">', "UTF-8 或含 BOM 的 CSV；Excel 请先另存为 CSV") +
        field("或直接粘贴", '<textarea id="hrimpText" rows="6" placeholder="姓名,手机,邮箱,来源,关联职位,备注&#10;张三,13800000000,zhang@example.com,内推,林学专业技术岗,下周可面"></textarea>') +
        '<p class="hrform-note" id="hrimpHint">两种方式二选一。导入后可在列表里继续改阶段。</p>' +
        "</div>",
      onOk: function (wrap) {
        var ta = wrap.querySelector("#hrimpText");
        var fileEl = wrap.querySelector("#hrimpFile");
        var text = String(ta.value || "").trim();
        if (text) {
          var r = HR.talent.importText(text);
          finish(r, wrap);
          return true;
        }
        if (fileEl.files && fileEl.files[0]) {
          var f = fileEl.files[0];
          var reader = new FileReader();
          var hint = wrap.querySelector("#hrimpHint");
          if (hint) hint.textContent = "正在读取 " + f.name + " …";
          reader.onload = function () {
            var r = HR.talent.importText(String(reader.result || ""));
            finish(r, wrap);
            m.close();
          };
          reader.onerror = function () { HR.toast("文件读取失败"); };
          reader.readAsText(f, "utf-8");
          return false; /* 等异步读完再关 */
        }
        err(wrap, "先选一个 CSV 文件，或粘贴几行数据");
        return false;
      }
    });
    function finish(r, wrap) {
      if (r && r.error) { err(wrap, r.error); return; }
      HR.toast("导入完成：新增 " + ((r && r.added) || 0) + " 人，跳过 " + ((r && r.skipped) || 0) + " 人");
      renderTalent(document.getElementById("view-talent"));
    }
    return m;
  }

  HR.views.talent = renderTalent;
  HR.views.focusTalent = function (id) { openTalentDetail(String(id || "")); };
})();
