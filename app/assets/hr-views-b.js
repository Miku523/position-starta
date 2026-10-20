/* =====================================================================
   星他 STARTA · 变化提醒 / 对标简报 / 设置与合规（v1.1）
   ---------------------------------------------------------------------
     watch    —— 提醒中心：规则、未读动态、全部标记已读
     brief    —— 一页纸：预览、勾选章节、打印、下载 HTML、复制 Markdown
     settings —— 设置与合规：数据源台账、角色权限、集成位、PIPL、本地数据

   依赖 window.HR（hr-core.js / hr-market.js）。
   ===================================================================== */
(function () {
  "use strict";

  var HR = window.HR;
  if (!HR) { console.error("[HR] hr-core.js 还没加载，视图无法注册"); return; }
  var esc = HR.esc, fmt = HR.fmt, q = HR.q;
  var icon = HR.icon;

  var RULE_TYPE_LB = { unit: "单位", keyword: "关键词", region: "地区" };

  /* ---------------- 小工具 ---------------- */
  function toggleSwitch(on, attrs) {
    return '<button type="button" class="hrswitch' + (on ? " on" : "") + '" role="switch" aria-checked="' + (on ? "true" : "false") + '" ' + (attrs || "") + '><i></i></button>';
  }
  function kindIcon(kind) {
    return { notice: "doc", jobs: "list", deadline: "clock", jd: "alert", talent: "user" }[kind] || "bell";
  }

  /* =====================================================================
     提醒中心
     ===================================================================== */
  function renderWatch(page) {
    if (!page) return;
    var rows = HR.rules.list();
    var hit = rows.reduce(function (a, r) {
      try { a += HR.rules.rows(r).length; } catch (e) { /* ignore */ }
      return a;
    }, 0);
    var notifs = HR.notifications();
    var unread = notifs.length;
    var snapshot = HR.meta().snapshot || HR.isoDate(new Date());

    var ro = HR.canWrite() ? "" : ' disabled title="只读角色：切换到「招聘负责人」后可改规则"';
    var head = '<div class="page-head"><div><h1>变化提醒</h1><p class="sub">不是营销式推送：只有「规则命中 / 对标临近截止 / JD 门槛风险 / 候选人滞留」才会出现在这里。</p></div>' +
      '<div class="head-side"><button type="button" class="btn ghost" data-hr-act="watch-readall" ' + (unread ? "" : "disabled") + ">全部已读</button>" +
      '<button type="button" class="btn ghost" data-hr-act="watch-rules-add"' + ro + ">加一条规则</button></div></div>";

    var kpis = '<div class="kpis four">' +
      '<div class="kpi"><span>未读提醒</span><b>' + unread + "</b><small>点铃铛可随时看</small></div>" +
      '<div class="kpi"><span>提醒规则</span><b>' + rows.filter(function (r) { return r.enabled; }).length + "/" + rows.length + "</b><small>启用 / 全部</small></div>" +
      '<div class="kpi"><span>规则命中岗位</span><b>' + fmt(hit) + "</b><small>按当前岗位表快照</small></div>" +
      '<div class="kpi"><span>数据快照</span><b class="mono">' + esc(snapshot) + "</b><small>采集链路：Lexmount 云浏览器</small></div>" +
      "</div>";

    var rulesPanel = '<div class="panel hrpanel"><div class="panel-hd"><b>提醒规则</b><span>单位 / 关键词 / 地区命中岗位表后，新岗位进入提醒（演示版按快照比对）</span></div>' +
      '<div class="hrrules">' +
        (rows.length ? rows.map(function (r) {
          var n = 0;
          var ex = "";
          try { var rr = HR.rules.rows(r); n = rr.length; ex = rr.slice(0, 2).map(function (d) { return d.u + " · " + d.r; }).join("；"); } catch (e) { /* ignore */ }
          return '<div class="hrrule' + (r.enabled ? "" : " is-off") + '" data-rule="' + esc(r.id) + '">' +
            '<span class="hrrule-t">' + esc(RULE_TYPE_LB[r.type] || r.type) + "</span>" +
            '<b class="hrrule-v">' + esc(r.value) + "</b>" +
            '<span class="hrrule-n">命中 ' + fmt(n) + " 个岗位" + (ex ? " · 如 " + esc(ex) : "") + "</span>" +
            toggleSwitch(r.enabled !== false, 'data-hr-act="rule-toggle" data-id="' + esc(r.id) + '" aria-label="启停规则"') +
            '<button type="button" class="icobtn" data-hr-act="rule-del" data-id="' + esc(r.id) + '" aria-label="删除规则" title="删除规则">' + icon("trash", 14) + "</button>" +
            "</div>";
        }).join("") : '<div class="hr-empty small"><b>还没有规则</b><span>加一条「广州」「林学」这样的单位或关键词，新岗位就会进提醒。</span></div>') +
      "</div></div>";

    var notifPanel = '<div class="panel hrpanel"><div class="panel-hd"><b>未读动态</b><span>' + (unread ? unread + " 条未读" : "全部已读") + "</span></div>" +
      (unread ? '<div class="hrnotifs">' + notifs.map(function (n) {
        return '<button type="button" class="hrnotif ' + esc(n.tone || "") + '" data-hr-act="notif-go" data-view="' + esc(n.view) + '" data-param="' + esc(n.param || "") + '">' +
          '<span class="hrnotif-ic">' + icon(kindIcon(n.kind), 16) + "</span>" +
          '<span class="hrnotif-main"><b>' + esc(n.title) + "</b><small>" + esc(n.desc) + "</small></span>" +
          '<span class="hrnotif-at">' + esc(HR.atLabel(n.at)) + "</span>" +
          '<span class="hrnotif-go">' + icon("arrow", 14) + "</span></button>";
      }).join("") + "</div>"
        : '<div class="hr-empty small">' + icon("check", 22) + "<b>都看过了</b><span>新公告、对标截止、JD 风险、候选人滞留会自动出现在这里。</span></div>") +
      "</div>";

    var explain = '<div class="callout">提醒口径：①公告发布 7 天内；②岗位库条数增加；③对标清单岗位 ≤7 天截止；④在招 JD 门槛与市场不一致；⑤候选人待初筛超过 2 天。数据留在本地浏览器，不发邮件、不进第三方队列。</div>';

    page.innerHTML = head + kpis + explain + rulesPanel + notifPanel;
    bindWatch(page);
  }

  function bindWatch(page) {
    if (page.__hrBoundWatch) return;
    page.__hrBoundWatch = true;
    page.addEventListener("click", function (e) {
      var b = e.target.closest("[data-hr-act]");
      if (!b) return;
      var act = b.getAttribute("data-hr-act");
      if (act === "watch-readall") {
        HR.markAllSeen();
        HR.refreshBell();
        renderWatch(page);
        HR.toast("已全部标记为已读");
        return;
      }
      if (act === "rule-toggle") {
        HR.rules.toggle(b.getAttribute("data-id"));
        HR.refreshBell();
        renderWatch(page);
        return;
      }
      if (act === "rule-del") {
        HR.rules.remove(b.getAttribute("data-id"));
        HR.refreshBell();
        renderWatch(page);
        return;
      }
      if (act === "watch-rules-add") {
        addRuleForm(page);
        return;
      }
      if (act === "notif-go") {
        var v = b.getAttribute("data-view");
        var p = b.getAttribute("data-param");
        var nid = b.getAttribute("data-nid");
        if (nid) HR.markSeen(nid);
        HR.jump(v, p);
        HR.refreshBell();
        renderWatch(page);
        return;
      }
    });
  }

  function addRuleForm(page) {
    var m = HR.modal({
      title: "加一条提醒规则",
      sub: "命中岗位表里的单位、岗位/专业关键词或地区",
      okText: "添加规则",
      body: '<div class="hrform">' +
        '<label class="fld"><span>规则类型</span><select name="type">' +
          '<option value="unit">单位名称包含</option><option value="keyword">岗位 / 专业关键词</option><option value="region">工作地区</option>' +
        "</select></label>" +
        '<label class="fld"><span>内容 *</span><input name="value" maxlength="40" placeholder="例如：广州 / 林学 / 林业局"></label>' +
        "</div>",
      onOk: function (wrap) {
        var f = {};
        wrap.querySelectorAll("[name]").forEach(function (el) { f[el.getAttribute("name")] = String(el.value || "").trim(); });
        if (!f.value) { HR.toast("先写规则内容"); return false; }
        var ok = HR.rules.add(f.type, f.value);
        if (!ok) return false;
        HR.refreshBell();
        renderWatch(page);
        HR.toast("规则已添加");
        return true;
      }
    });
    return m;
  }

  /* =====================================================================
     对标简报
     ===================================================================== */
  var briefOpts = { sections: null };

  function sectionState() {
    if (!briefOpts.sections) {
      briefOpts.sections = {};
      HR.brief.sections.forEach(function (s) { briefOpts.sections[s.k] = s.on !== false; });
    }
    return briefOpts.sections;
  }

  function renderBrief(page) {
    if (!page) return;
    var opts = { sections: sectionState() };
    var model = HR.brief.model(opts);
    var head = '<div class="page-head"><div><h1>对标简报</h1><p class="sub">一页纸：招聘画像、对标清单、JD 差距、提醒、建议动作。屏幕预览的样子就是打印的样子。</p></div>' +
      '<div class="head-side"><button type="button" class="btn ghost" data-hr-act="brief-md">复制 Markdown</button>' +
      '<button type="button" class="btn ghost" data-hr-act="brief-html">下载 HTML</button>' +
      '<button type="button" class="btn primary" data-hr-act="brief-print">打印 / 存 PDF</button></div></div>';

    var toolbar = '<div class="toolbar hrbrief-tool">' +
      '<div class="hrchips">' + HR.brief.sections.map(function (s) {
        return '<label class="hrcheck"><input type="checkbox" data-hr-sec="' + esc(s.k) + '"' + (opts.sections[s.k] !== false ? " checked" : "") + "><span>" + esc(s.lb) + "</span></label>";
      }).join("") + "</div>" +
      '<span class="hrmuted">勾选要出现在简报里的章节，改动即时生效；数字全部按当前数据现算。</span>' +
      "</div>";

    var preview = '<div class="hrbrief-preview" id="hrBriefPreview">' + HR.brief.html(model) + "</div>";
    page.innerHTML = head + toolbar + preview;
    bindBrief(page);
  }

  function bindBrief(page) {
    if (page.__hrBoundBrief) return;
    page.__hrBoundBrief = true;
    page.addEventListener("change", function (e) {
      var cb = e.target.closest("[data-hr-sec]");
      if (!cb) return;
      briefOpts.sections[cb.getAttribute("data-hr-sec")] = !!cb.checked;
      renderBrief(page);
    });
    page.addEventListener("click", function (e) {
      var b = e.target.closest("[data-hr-act]");
      if (!b) return;
      var act = b.getAttribute("data-hr-act");
      var opts = { sections: sectionState() };
      var model = HR.brief.model(opts);
      if (act === "brief-print") { e.preventDefault(); printBrief(model); return; }
      if (act === "brief-html") {
        e.preventDefault();
        HR.download("招聘对标简报_" + HR.isoDate(new Date()) + ".html", HR.brief.standalone(model), "text/html;charset=utf-8");
        HR.toast("已下载独立 HTML，可直接发人或打印");
        return;
      }
      if (act === "brief-md") {
        e.preventDefault();
        HR.copyText(HR.brief.markdown(model)).then(function (ok) {
          HR.toast(ok ? "Markdown 已复制，可贴到 IM 或文档" : "复制失败，请改用下载 HTML");
        });
        return;
      }
    });
  }

  function printBrief(model) {
    var html = HR.brief.standalone(model);
    var frame = document.createElement("iframe");
    frame.setAttribute("title", "简报打印预览");
    frame.style.cssText = "position:fixed;left:-10000px;top:0;width:900px;height:1300px;border:0";
    document.body.appendChild(frame);
    var d = frame.contentDocument || frame.contentWindow.document;
    d.open();
    d.write(html);
    d.close();
    var tryPrint = function () {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (err) {
        HR.toast("浏览器阻止了打印，请改用「下载 HTML」");
      }
      setTimeout(function () { frame.remove(); }, 4000);
    };
    setTimeout(tryPrint, 260);
  }

  /* =====================================================================
     设置与合规
     ===================================================================== */
  function renderSettings(page) {
    if (!page) return;
    var meta = HR.meta();
    var notices = HR.notices();
    var data = HR.positions();
    var profile = HR.profile();
    var st = HR.state();
    var audit = (st.audit || []).slice(0, 40);

    var head = '<div class="page-head"><div><h1>设置与合规</h1><p class="sub">这个页面回答三个问题：数据从哪来、谁在动它、接简历会不会踩 PIPL。</p></div>' +
      '<div class="head-side"><button type="button" class="btn ghost" data-hr-act="set-profile">改招聘方信息</button></div></div>';

    /* 数据源台账 */
    var srcPanel = '<div class="panel hrpanel"><div class="panel-hd"><b>数据源台账</b><span>快照 ' + esc(meta.snapshot || "—") + " · 可回溯到公告原文</span></div>" +
      '<div class="hrkvs">' +
        kv("岗位表", fmt(data.length) + " 行 × 16 列") +
        kv("单位", fmt(meta.units || new Set(data.map(function (d) { return d.u; })).size) + " 家") +
        kv("名额", fmt(meta.seats || data.reduce(function (a, d) { return a + (Number(d.n) || 0); }, 0)) + " 个") +
        kv("公告", notices.length + " 份") +
        kv("地区", fmt(meta.regions || 24) + " 个城市") +
        kv("薪资口径", "缺失（原公告无薪资字段，简报不做薪资对比）") +
      "</div>" +
      '<div class="hrnotices">' + notices.map(function (n) {
        return '<div class="hrnotice">' +
          '<div><b>' + esc(n.title) + "</b><small>" + esc(n.org || "") + " · 发布 " + esc(n.published || "—") + " · " + fmt(n.rows || 0) + " 个岗位" + (n.attachments ? " · " + n.attachments.length + " 个附件" : "") + "</small></div>" +
          (n.url ? '<a class="hlink" href="' + esc(n.url) + '" target="_blank" rel="noopener">公告原文 ↗</a>' : '<span class="hrmuted">本地快照</span>') +
          "</div>";
      }).join("") + "</div>" +
      '<p class="hrnote-line">' + icon("alert", 13) + ' 字段映射：src 来源 / t 性质 / u 单位 / r 岗位 / code 岗位代码 / e 学历 / deg 学位 / m 专业 / mf 门类 / n 名额 / city 地区 / x 经验 / cand 考生类别 / dept 部门 / lv 级别 / add 新增。采集链路：Lexmount 云浏览器抓公告 → 解析岗位表 → build_jobs.py 生成 js 数据层。</p></div>';

    /* 角色与权限 */
    var rolePanel = '<div class="panel hrpanel"><div class="panel-hd"><b>角色与权限</b><span>当前：' + esc(HR.role().lb) + "（" + esc(HR.role().tag) + "）</span></div>" +
      '<div class="hrroles">' + HR.roles.map(function (r) {
        var on = r.k === HR.roleKey();
        return '<div class="hrrole' + (on ? " on" : "") + '"><div><b>' + esc(r.lb) + "<em>" + esc(r.tag) + "</em></b><small>" + esc(r.desc) + "</small></div>" +
          (on ? '<span class="chip on">当前</span>' : '<button type="button" class="btn ghost" data-hr-act="set-role" data-role="' + esc(r.k) + '">切换</button>') + "</div>";
      }).join("") + "</div>" +
      '<p class="hrnote-line">' + icon("alert", 13) + ' 权限只在前端做门控（演示版没有账号后端）。真实上线时要接 SSO / RBAC，服务端校验每个写接口。</p></div>';

    /* 集成位 */
    var intPanel = '<div class="panel hrpanel"><div class="panel-hd"><b>集成位</b><span>接口位置已留，未接真实凭证</span></div>' +
      '<div class="hrints">' +
        intCard("企业微信 / 飞书", "把新公告、对标截止推进群机器人。需要 webhook 地址与签名密钥。", "未连接") +
        intCard("ATS / HRIS", "候选人、职位双向同步（北森、Moka、Workday 等）。需要开放 API 或 CSV 定时任务。", "未连接") +
        intCard("邮件 / 短信", "面试邀约与 offer 通知。涉及手机号与邮箱，属个人信息，需要单独授权。", "未连接") +
        intCard("采集调度", "把 Lexmount 采集做成每日定时任务，失败重试与变更 diff。server.js 已有引擎，缺调度与告警。", "半就绪") +
      "</div></div>";

    /* 合规 */
    var lawPanel = '<div class="panel hrpanel"><div class="panel-hd"><b>合规与个人信息</b><span>PIPL（个人信息保护法）口径</span></div>' +
      '<ul class="hrlaw">' +
        "<li><b>最小必要</b>：当前只收姓名、手机、邮箱、来源、备注；不采身份证、住址、健康信息。</li>" +
        "<li><b>本地优先</b>：候选人数据存在本浏览器 localStorage（键 starta-hr-v1），不上传服务器；换浏览器/清缓存即丢失。</li>" +
        "<li><b>授权与告知</b>：导入简历前要取得候选人同意；导出 CSV 属于对外提供，需再次确认用途与范围。</li>" +
        "<li><b>保留期限</b>：建议招聘结束后 6 个月内删除未入职候选人数据（本版提供一键清空）。</li>" +
        "<li><b>来源标注</b>：岗位与公告均保留原文链接；数字以公告为准，简报不编造薪资。</li>" +
      "</ul>" +
      '<p class="hrnote-line">' + icon("alert", 13) + ' 现状风险：这是前端演示，不是合规系统。接入真实简历库前，需补隐私政策、授权记录、加密存储、访问审计与数据出境评估。</p></div>';

    /* 本地数据 */
    var size = 0;
    try { size = (JSON.stringify(st).length / 1024).toFixed(1); } catch (e) { size = "—"; }
    var localPanel = '<div class="panel hrpanel"><div class="panel-hd"><b>本地数据</b><span>只存在这台设备的浏览器里</span></div>' +
      '<div class="hrkvs">' +
        kv("招聘数据", size + " KB（职位 " + st.jd.length + " · 候选人 " + st.talent.length + " · 规则 " + st.rules.length + "）") +
        kv("对标清单", HR.bench().rows.length + " 个岗位（键 strata-wb-bench，与其他模块共用）") +
        kv("存储位置", "localStorage · starta-hr-v1") +
      "</div>" +
      '<div class="hrdanger"><button type="button" class="btn ghost danger" data-hr-act="set-clear-hr">清空招聘数据</button>' +
      '<span class="hrmuted">只删职位 / 候选人 / 规则 / 审计，不动对标清单与求职者资料。</span></div></div>';

    /* 审计 */
    var auditPanel = '<div class="panel hrpanel"><div class="panel-hd"><b>操作日志</b><span>最近 ' + audit.length + " 条 · 最多保留 200 条</span></div>" +
      (audit.length ? '<div class="hraudit">' + audit.map(function (a) {
        return '<div class="hraudit-row"><span class="hraudit-at mono">' + esc(a.at) + "</span>" +
          '<span class="hraudit-who">' + esc(a.actor) + ' <em>' + esc(a.roleLb || a.role || "") + "</em></span>" +
          '<span class="hraudit-act">' + esc(a.action) + "</span>" +
          '<span class="hraudit-det">' + esc(a.detail) + "</span></div>";
      }).join("") + "</div>" : '<div class="hr-empty small"><b>还没有操作记录</b><span>建职位、导人才、切角色都会记在这里。</span></div>') +
      "</div>";

    var about = '<div class="hrfoot">星他 STARTA · 招聘情报台 v' + esc(HR.version) + " · 单文件可离线打开 · 数据快照 " + esc(meta.snapshot || "—") + "</div>";

    page.innerHTML = head + srcPanel + rolePanel + intPanel + lawPanel + localPanel + auditPanel + about;
    bindSettings(page);
  }

  function kv(k, v) {
    return '<div class="hrkv"><span>' + esc(k) + "</span><b>" + esc(v) + "</b></div>";
  }
  function intCard(title, desc, status) {
    return '<div class="hrint"><div><b>' + esc(title) + "</b><small>" + esc(desc) + "</small></div><span class=\"chip\">" + esc(status) + "</span></div>";
  }

  function bindSettings(page) {
    if (page.__hrBoundSet) return;
    page.__hrBoundSet = true;
    page.addEventListener("click", function (e) {
      var b = e.target.closest("[data-hr-act]");
      if (!b) return;
      var act = b.getAttribute("data-hr-act");
      if (act === "set-role") {
        HR.setRole(b.getAttribute("data-role"));
        renderSettings(page);
        return;
      }
      if (act === "set-profile") {
        var p = HR.profile();
        var m = HR.modal({
          title: "招聘方信息",
          sub: "显示在侧栏与操作日志里",
          okText: "保存",
          body: '<div class="hrform">' +
            '<label class="fld"><span>姓名</span><input name="name" maxlength="20" value="' + esc(p.name) + '"></label>' +
            '<label class="fld"><span>公司 / 组织</span><input name="org" maxlength="30" value="' + esc(p.org) + '"></label>' +
            '<label class="fld"><span>默认城市</span><input name="city" maxlength="20" value="' + esc(p.city) + '"></label>' +
            "</div>",
          onOk: function (wrap) {
            var f = {};
            wrap.querySelectorAll("[name]").forEach(function (el) { f[el.getAttribute("name")] = String(el.value || "").trim(); });
            if (!f.name) { HR.toast("姓名不能为空"); return false; }
            var st = HR.state();
            st.profile.name = f.name;
            st.profile.org = f.org;
            st.profile.city = f.city;
            HR.save();
            HR.audit("更新招聘方信息", f.name + " · " + f.org, "settings");
            HR.mountChrome();
            renderSettings(page);
            HR.toast("已保存");
            return true;
          }
        });
        return;
      }
      if (act === "set-clear-hr") {
        HR.confirm("清空招聘数据", "会删除职位、候选人、提醒规则与操作日志（对标清单与求职者资料不受影响）。确定？", function () {
          try { localStorage.removeItem("starta-hr-v1"); } catch (err) { /* ignore */ }
          location.reload();
        }, "清空");
        return;
      }
    });
  }

  /* ---------------- 注册 ---------------- */
  HR.views.watch = renderWatch;
  HR.views.brief = renderBrief;
  HR.views.settings = renderSettings;
})();
