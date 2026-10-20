/* =====================================================================
   星他 STARTA · 市场基准 + 一页纸简报（v1.1）
   ---------------------------------------------------------------------
   HR.market  ——  用 9,200 条真实岗位表算「同类岗位」的口径：
                  学历 / 考生类别 / 名额 / 专业门类 / 地区 / 截止节奏
   HR.brief   ——  把「职位 + 对标清单 + 提醒 + 数据口径」组织成
                  一页纸：屏幕上预览、打印、下载独立 HTML、复制 Markdown

   注意：岗位表没有薪资字段，简报里明确写「薪资口径缺失」，
   不编造数据；所有数字都能回放到 assets/jobs.data.js。
   ===================================================================== */
(function () {
  "use strict";

  var HR = window.HR;
  if (!HR) { console.error("[HR] hr-core.js 还没加载"); return; }
  var esc = HR.esc, fmt = HR.fmt;

  /* ---------------- 口径映射 ---------------- */
  function eduRank(label) {
    var s = String(label || "");
    if (!s || s.indexOf("不限") >= 0) return 0;
    if (/博士/.test(s)) return 5;
    if (/硕士|研究生/.test(s)) return 4;
    if (/本科/.test(s)) return 3;
    if (/专科|大专|高职/.test(s)) return 2;
    if (/高中|中专|中职|技校/.test(s)) return 1;
    return 0;
  }
  function eduLabel(rank) {
    return ["不限", "高中/中专", "专科", "本科", "硕士", "博士"][rank] || "不限";
  }
  function expRank(label) {
    var s = String(label || "");
    if (!s || s.indexOf("不限") >= 0) return 0;
    if (/应届|无经验|在校|毕业生/.test(s)) return 1;
    var m = /(\d+)\s*[-~至到]?\s*(\d+)?\s*年/.exec(s);
    if (m) {
      var a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
      var avg = (a + b) / 2;
      if (avg <= 1) return 2;
      if (avg <= 2) return 3;
      if (avg <= 4) return 4;
      return 5;
    }
    if (/一年|1年/.test(s)) return 2;
    if (/两三年|3年|三年/.test(s)) return 4;
    if (/五年|5年|以上/.test(s)) return 5;
    return 2;
  }
  function expLabel(rank) {
    return ["不限", "应届/无经验", "1 年以内", "1–2 年", "3–5 年", "5 年以上"][rank] || "不限";
  }
  function candRank(label) {
    var s = String(label || "");
    if (!s || s.indexOf("不限") >= 0) return 0;
    if (/应届|毕业生/.test(s)) return 1;
    if (/社会/.test(s)) return 2;
    return 0;
  }

  function median(arr) {
    var a = arr.filter(function (v) { return typeof v === "number" && isFinite(v); }).sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }
  function quantile(arr, p) {
    var a = arr.filter(function (v) { return typeof v === "number" && isFinite(v); }).sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    if (a.length === 1) return a[0];
    var pos = (a.length - 1) * p;
    var lo = Math.floor(pos), hi = Math.ceil(pos);
    return a[lo] + (a[hi] - a[lo]) * (pos - lo);
  }
  function tally(list, keyFn) {
    var m = new Map();
    list.forEach(function (x) {
      var k = keyFn(x);
      m.set(k, (m.get(k) || 0) + 1);
    });
    return Array.from(m.entries())
      .map(function (e) { return { k: e[0], v: e[1] }; })
      .sort(function (a, b) { return b.v - a.v || String(a.k).localeCompare(String(b.k), "zh"); });
  }
  function pct(part, total) {
    if (!total) return "0%";
    return Math.round(part / total * 100) + "%";
  }

  /* 专业关键词：把「计算机类、软件工程」拆成可比对的门类/专业词 */
  var MAJOR_STOP = ["专业", "门类", "类", "相关", "或", "及", "以上", "毕业", "等", "不限"];
  function majorTokens(str) {
    return String(str || "")
      .split(/[、，,;；\/|（）()【】\s]+/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) {
        if (!s || s.length < 2) return false;
        return !MAJOR_STOP.some(function (w) { return s === w; });
      });
  }
  function majorHit(d, tokens) {
    if (!tokens.length) return true;
    var hay = String(d.m || "") + " " + String(d.mf || "") + " " + String(d.r || "");
    return tokens.some(function (t) { return hay.indexOf(t) >= 0; });
  }

  /* ---------------- 同类岗位 ---------------- */
  function matchJobs(jd, opts) {
    opts = opts || {};
    var data = HR.positions();
    var tokens = majorTokens(jd.major);
    var city = String(jd.city || "").replace(/市$/, "");
    var base = data;
    if (jd.type && (jd.type === "事业单位" || jd.type === "国企")) {
      base = base.filter(function (d) { return d.t === jd.type; });
    }
    var byMajor = base.filter(function (d) { return majorHit(d, tokens); });
    if (byMajor.length < 6) byMajor = base; /* 专业拆不出来就退回同性质全量 */
    var sameCity = byMajor.filter(function (d) { return city && String(d.city || "").indexOf(city) >= 0; });
    var list = sameCity;
    var relaxed = false;
    if (list.length < (opts.min || 8)) {
      list = byMajor;
      relaxed = true;
    }
    if (!list.length) list = base;
    return { list: list, relaxed: relaxed, tokens: tokens, city: city, baseCount: base.length };
  }

  function benchmark(jd) {
    var m = matchJobs(jd);
    var list = m.list;
    var eduHist = tally(list, function (d) { return eduLabel(eduRank(d.e)); });
    var candHist = tally(list, function (d) { return String(d.cand || "不限"); });
    var typeHist = tally(list, function (d) { return String(d.t || "未知"); });
    var mfHist = tally(list, function (d) { return String(d.mf || "不限"); });
    var seats = list.map(function (d) { return Number(d.n) || 0; }).filter(function (n) { return n > 0; });
    var lefts = list.map(function (d) { return d.left; }).filter(function (n) { return n != null; });
    var units = new Set(list.map(function (d) { return d.u; }).filter(Boolean));
    return {
      jd: jd,
      sample: list.length,
      relaxed: m.relaxed,
      list: list,
      city: m.city,
      baseCount: m.baseCount,
      tokens: m.tokens,
      edu: eduHist,
      cand: candHist,
      type: typeHist,
      mf: mfHist,
      seatsTotal: seats.reduce(function (a, b) { return a + b; }, 0),
      seatsMedian: median(seats),
      seatsP25: quantile(seats, 0.25),
      seatsP75: quantile(seats, 0.75),
      seatsMax: seats.length ? Math.max.apply(null, seats) : null,
      units: units.size,
      soon7: list.filter(function (d) { return d.left != null && d.left >= 0 && d.left <= 7; }).length,
      open: list.filter(function (d) { return d.open; }).length,
      deadlines: lefts.length ? Math.round(median(lefts)) : null
    };
  }

  function marketEduMedian(bench) {
    var total = bench.sample;
    var acc = 0;
    var hist = bench.edu;
    var order = ["不限", "高中/中专", "专科", "本科", "硕士", "博士"];
    var sorted = order.map(function (lb) {
      var hit = hist.filter(function (h) { return h.k === lb; })[0];
      return { k: lb, v: hit ? hit.v : 0 };
    });
    for (var i = 0; i < sorted.length; i++) {
      acc += sorted[i].v;
      if (acc >= total / 2) return eduRank(sorted[i].k);
    }
    return 0;
  }

  function gap(jd) {
    var bench = benchmark(jd);
    var flags = [];
    var level = "ok";
    if (!bench.sample) {
      return { level: "watch", sample: 0, flags: ["市场样本为空，先放宽城市/专业口径"], summary: "暂无同类样本，无法给出差距。", bench: bench };
    }
    var marketEdu = marketEduMedian(bench);
    var jdEdu = eduRank(jd.edu);
    if (jdEdu > marketEdu) {
      flags.push("学历门槛高于同类中位：要求「" + (jd.edu || "不限") + "」，同类岗位一半只要求「" + eduLabel(marketEdu) + "」及以下");
      level = "watch";
      if (jdEdu - marketEdu >= 2) level = "high";
    }
    var topEdu = bench.edu[0];
    if (topEdu && eduRank(topEdu.k) < jdEdu) {
      flags.push("同类岗位最集中的学历口径是「" + topEdu.k + "」（" + pct(topEdu.v, bench.sample) + "），你的要求高一档");
      if (level === "ok") level = "watch";
    }
    var jdExp = expRank(jd.exp);
    var freshShare = bench.cand.filter(function (c) {
      return /应届|毕业生|不限/.test(c.k);
    }).reduce(function (a, c) { return a + c.v; }, 0) / bench.sample;
    if (jdExp >= 4 && freshShare >= 0.8) {
      flags.push("经验口径偏窄：同类岗位 " + pct(Math.round(freshShare * bench.sample), bench.sample) + " 面向应届/不限，你要求「" + (jd.exp || "不限") + "」");
      level = level === "high" ? "high" : "watch";
    }
    if (jd.headcount && bench.seatsP75 && Number(jd.headcount) > bench.seatsP75) {
      flags.push("招聘量 " + jd.headcount + " 人，高于同类 75 分位（" + Math.round(bench.seatsP75) + " 人/岗），需要更长的到岗周期");
      if (level === "ok") level = "watch";
    }
    if (bench.sample < 8 || bench.relaxed) {
      flags.push("同类样本 " + bench.sample + " 条" + (bench.relaxed ? "（已放宽城市口径到" + (jd.type === "国企" ? "全国" : "全省") + "）" : "") + "，结论按趋势看");
    }
    if (bench.tokens.length && bench.list.length && bench.mf.length) {
      var hitTop = bench.mf[0];
      var tokenHit = majorTokens(jd.major).some(function (t) {
        return String(hitTop.k || "").indexOf(t) >= 0;
      });
      if (!tokenHit && majorTokens(jd.major).length) {
        flags.push("专业口径与同类主流门类不一致：市场最集中的是「" + hitTop.k + "」");
        if (level === "ok") level = "watch";
      }
    }
    var summary = flags.length ? flags[0] : "学历、经验、名额都与市场同类基本一致，门槛处于合理区间。";
    return {
      level: level,
      sample: bench.sample,
      flags: flags,
      summary: summary,
      bench: bench,
      marketEdu: marketEdu,
      jdEdu: jdEdu,
      jdExp: jdExp,
      freshShare: freshShare
    };
  }

  HR.market = {
    eduRank: eduRank,
    eduLabel: eduLabel,
    expRank: expRank,
    expLabel: expLabel,
    candRank: candRank,
    majorTokens: majorTokens,
    majorHit: majorHit,
    matchJobs: matchJobs,
    benchmark: benchmark,
    gap: gap,
    median: median,
    quantile: quantile,
    tally: tally,
    pct: pct
  };

  /* =====================================================================
     一页纸简报
     ===================================================================== */
  var BRIEF_SECTIONS = [
    { k: "overview", lb: "概览", on: true },
    { k: "profile", lb: "招聘画像", on: true },
    { k: "bench", lb: "对标清单", on: true },
    { k: "jd", lb: "JD 差距", on: true },
    { k: "remind", lb: "提醒摘要", on: true },
    { k: "actions", lb: "建议动作", on: true },
    { k: "source", lb: "口径与来源", on: true }
  ];

  function briefModel(opts) {
    opts = opts || {};
    var savedOnly = !!opts.savedOnly;
    var sections = opts.sections || BRIEF_SECTIONS.reduce(function (o, s) { o[s.k] = s.on; return o; }, {});
    var bench = HR.bench();
    var benchRows = bench.rows;
    var pool = benchRows;
    var jdList = HR.jd.list();
    var liveJds = jdList.filter(function (j) { return j.status === "live"; });
    var targetJds = (opts.jdIds && opts.jdIds.length)
      ? jdList.filter(function (j) { return opts.jdIds.indexOf(j.id) >= 0; })
      : liveJds;
    var talent = HR.talent.list();
    var meta = HR.meta();
    var today = HR.isoDate(new Date());

    /* 画像：对标清单为空时退到全库，保证简报不空转 */
    var profilePool = pool.length ? pool : HR.positions();
    var profileNote = pool.length ? "对标清单 " + pool.length + " 条" : "全库 " + fmt(profilePool.length) + " 条（对标清单为空，画像按全库计算）";

    var eduHist = tally(profilePool, function (d) { return HR.market.eduLabel(HR.market.eduRank(d.e)); });
    var candHist = tally(profilePool, function (d) { return String(d.cand || "不限"); });
    var typeHist = tally(profilePool, function (d) { return String(d.t || "未知"); });
    var cityHist = tally(profilePool, function (d) { return String(d.city || "未知"); }).slice(0, 6);
    var seats = profilePool.map(function (d) { return d.n; }).filter(function (n) { return n > 0; });

    var gaps = targetJds.map(function (j) {
      var g = null;
      try { g = gap(j); } catch (e) { g = null; }
      return { jd: j, gap: g };
    }).filter(function (x) { return x.gap; });

    var reminds = HR.notifications().slice(0, 6);

    /* 建议动作：从数据里推，不写套话 */
    var actions = [];
    if (!jdList.length) actions.push("先在「我的职位」里建一个 JD（或从市场岗位库一键起草），简报才会生成门槛差距。");
    gaps.forEach(function (x) {
      var g = x.gap;
      if (g.level === "high") actions.push("「" + x.jd.title + "」门槛高于市场：优先降学历或放宽经验口径，再投渠道。");
      else if (g.level === "watch" && g.flags.length) actions.push("「" + x.jd.title + "」有 " + g.flags.length + " 项口径偏紧，建议对照同类岗位调整 1 项。");
    });
    if (benchRows.length) {
      var soon = benchRows.filter(function (d) { return d.left != null && d.left >= 0 && d.left <= 7; });
      if (soon.length) actions.push("对标清单里有 " + soon.length + " 个岗位 7 天内截止，先处理这批（" + soon.slice(0, 3).map(function (d) { return d.r; }).join(" / ") + "）。");
    } else {
      actions.push("对标清单为空：在市场岗位库里把要跟踪的岗位点「对标」，简报就能按你的清单算。");
    }
    var pending = talent.filter(function (t) { return t.stage === "new"; });
    if (pending.length) actions.push(pending.length + " 位候选人还没初筛，先过一遍再排面试。");
    if (!actions.length) actions.push("当前没有需要处理的异常，按招聘节奏推进即可。");

    return {
      title: "招聘对标简报",
      date: today,
      snapshot: meta.snapshot || today,
      target: savedOnly ? "对标清单" : "对标清单 + 我的职位",
      sections: sections,
      kpis: [
        { lb: "岗位库", v: fmt(HR.positions().length), ft: meta.units ? fmt(meta.units) + " 家单位 · " + fmt(meta.seats) + " 个名额" : "" },
        { lb: "对标清单", v: fmt(benchRows.length), ft: benchRows.length ? "覆盖 " + new Set(benchRows.map(function (d) { return d.u; })).size + " 家单位" : "还没标记岗位" },
        { lb: "我的职位", v: fmt(jdList.length), ft: "在招 " + liveJds.length + " 个 · 草稿 " + (jdList.length - liveJds.length) + " 个" },
        { lb: "候选人", v: fmt(talent.length), ft: "待初筛 " + talent.filter(function (t) { return t.stage === "new"; }).length + " 人" }
      ],
      profile: { note: profileNote, total: profilePool.length, edu: eduHist, cand: candHist, type: typeHist, city: cityHist, seatsMedian: median(seats) },
      bench: benchRows.map(function (d) {
        return {
          unit: d.u, role: d.r, type: d.t, city: d.city, edu: d.e, cand: d.cand, n: d.n,
          end: d.end || d.d, left: d.left, stage: HR.stageLabel[HR.bench().prog[d.i] && HR.bench().prog[d.i].st || "saved"] || "待研判"
        };
      }),
      jdGaps: gaps,
      reminds: reminds,
      actions: actions,
      source: {
        snapshot: meta.snapshot || today,
        notices: HR.notices().map(function (n) { return { title: n.title, org: n.org, published: n.published, url: n.url, rows: n.rows }; }),
        fieldNote: "字段来自公告岗位表 16 列；薪资口径缺失（原表无薪资字段），本简报不做薪资对比。",
        generatedAt: HR.isoMinute(new Date())
      }
    };
  }

  function briefHTML(model) {
    var s = model.sections || {};
    var h = [];
    h.push('<div class="bf-sheet">');
    h.push('<header class="bf-hd"><div class="bf-brand">星他 STARTA · 招聘情报台</div><h1>' + esc(model.title) + '</h1>');
    h.push('<p class="bf-sub">生成于 ' + esc(model.date) + ' · 数据快照 ' + esc(model.snapshot) + ' · 口径：' + esc(model.target) + '</p></header>');

    if (s.overview !== false) {
      h.push('<div class="bf-kpis">' + model.kpis.map(function (k) {
        return '<div class="bf-kpi"><span>' + esc(k.lb) + '</span><b>' + esc(k.v) + '</b><small>' + esc(k.ft || "") + '</small></div>';
      }).join("") + '</div>');
    }

    if (s.profile !== false) {
      h.push('<h2>招聘画像</h2><p class="bf-note">' + esc(model.profile.note) + '</p>');
      h.push('<div class="bf-bars">');
      h.push(barBlock("学历口径", model.profile.edu));
      h.push(barBlock("考生类别", model.profile.cand));
      h.push(barBlock("单位性质", model.profile.type));
      h.push(barBlock("地区分布", model.profile.city));
      h.push('</div>');
      if (model.profile.seatsMedian != null) {
        h.push('<p class="bf-note">名额中位数 ' + Math.round(model.profile.seatsMedian) + ' 人/岗。</p>');
      }
    }

    if (s.bench !== false) {
      h.push('<h2>对标清单</h2>');
      if (!model.bench.length) {
        h.push('<p class="bf-empty">清单为空。在市场岗位库里点「对标」，这里会自动按阶段与截止日列出。</p>');
      } else {
        h.push('<table class="bf-table"><thead><tr><th>单位</th><th>岗位</th><th>性质</th><th>学历</th><th>名额</th><th>截止</th><th>阶段</th></tr></thead><tbody>');
        model.bench.forEach(function (r) {
          h.push('<tr><td>' + esc(r.unit) + '<small>' + esc(r.city || "") + '</small></td><td>' + esc(r.role) + '</td><td>' + esc(r.type) + '</td><td>' + esc(r.edu) + '</td><td class="num">' + esc(r.n) + '</td><td>' + esc(r.end || "—") + (r.left != null && r.left >= 0 ? '<small>剩 ' + r.left + ' 天</small>' : "") + '</td><td>' + esc(r.stage) + '</td></tr>');
        });
        h.push('</tbody></table>');
      }
    }

    if (s.jd !== false) {
      h.push('<h2>JD 差距</h2>');
      if (!model.jdGaps.length) {
        h.push('<p class="bf-empty">还没有在招职位。到「我的职位」建 JD，或从市场岗位库一键起草，差距会自动算。</p>');
      } else {
        model.jdGaps.forEach(function (x) {
          var g = x.gap;
          h.push('<div class="bf-gap ' + esc(g.level) + '">');
          h.push('<div class="bf-gap-hd"><b>' + esc(x.jd.title) + '</b><span>' + esc([x.jd.dept, x.jd.city, x.jd.type].filter(Boolean).join(" · ")) + '</span><i class="bf-lv ' + esc(g.level) + '">' + (g.level === "high" ? "门槛偏高" : g.level === "watch" ? "需要关注" : "基本合理") + '</i></div>');
          h.push('<p class="bf-gap-sum">' + esc(g.summary) + '</p>');
          if (g.flags.length) h.push('<ul class="bf-flags">' + g.flags.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join("") + '</ul>');
          h.push('<p class="bf-note">同类样本 ' + fmt(g.sample) + ' 条 · 市场学历中位「' + esc(eduLabel(g.marketEdu)) + '」 · 你要求「' + esc(x.jd.edu || "不限") + '」</p>');
          h.push('</div>');
        });
      }
    }

    if (s.remind !== false) {
      h.push('<h2>提醒摘要</h2>');
      if (!model.reminds.length) {
        h.push('<p class="bf-empty">当前没有未读提醒。</p>');
      } else {
        h.push('<ul class="bf-remind">');
        model.reminds.forEach(function (n) {
          h.push('<li><b>' + esc(n.title) + '</b><span>' + esc(n.desc) + '</span></li>');
        });
        h.push('</ul>');
      }
    }

    if (s.actions !== false) {
      h.push('<h2>建议动作</h2><ol class="bf-actions">');
      model.actions.forEach(function (a) { h.push('<li>' + esc(a) + '</li>'); });
      h.push('</ol>');
    }

    if (s.source !== false) {
      h.push('<h2>口径与来源</h2>');
      h.push('<ul class="bf-src">');
      model.source.notices.forEach(function (n) {
        h.push('<li>' + esc(n.title) + '（' + esc(n.org || "") + ' · ' + esc(n.published || "") + ' · ' + fmt(n.rows || 0) + ' 个岗位）</li>');
      });
      h.push('<li>' + esc(model.source.fieldNote) + '</li>');
      h.push('<li>岗位明细保存在 assets/jobs.data.js（' + fmt(HR.positions().length) + ' 行 × 16 列），本简报所有数字由页面现算。</li>');
      h.push('<li class="bf-gen">生成时间 ' + esc(model.source.generatedAt) + ' · 星他 STARTA · Lexmount 云浏览器采集链路</li>');
      h.push('</ul>');
    }

    h.push('</div>');
    return h.join("");
  }

  function barBlock(title, hist) {
    var total = hist.reduce(function (a, x) { return a + x.v; }, 0) || 1;
    var top = hist.slice(0, 5);
    return '<div class="bf-barblock"><b>' + esc(title) + '</b>' + top.map(function (x) {
      var w = Math.max(2, Math.round(x.v / total * 100));
      return '<div class="bf-bar"><span class="bf-bar-l">' + esc(x.k) + '</span><i style="width:' + w + '%"></i><span class="bf-bar-v">' + pct(x.v, total) + '</span></div>';
    }).join("") + '</div>';
  }

  /* Markdown 版：方便贴到 IM / 文档 */
  function briefMD(model) {
    var L = [];
    L.push("# " + model.title);
    L.push("");
    L.push("生成于 " + model.date + " · 数据快照 " + model.snapshot + " · 口径：" + model.target);
    L.push("");
    L.push("## 概览");
    model.kpis.forEach(function (k) { L.push("- **" + k.lb + "**：" + k.v + (k.ft ? "（" + k.ft + "）" : "")); });
    L.push("");
    L.push("## 招聘画像");
    L.push(model.profile.note + "。");
    L.push("");
    ["edu", "cand", "type", "city"].forEach(function (key) {
      if (!model.profile[key] || !model.profile[key].length) return;
      var lb = { edu: "学历口径", cand: "考生类别", type: "单位性质", city: "地区分布" }[key];
      L.push("- " + lb + "：" + model.profile[key].slice(0, 5).map(function (x) { return x.k + " " + x.v; }).join("，"));
    });
    L.push("");
    L.push("## 对标清单");
    if (!model.bench.length) L.push("（清单为空）");
    else {
      L.push("| 单位 | 岗位 | 学历 | 名额 | 截止 | 阶段 |");
      L.push("| --- | --- | --- | --- | --- | --- |");
      model.bench.forEach(function (r) { L.push("| " + r.unit + " | " + r.role + " | " + (r.edu || "") + " | " + r.n + " | " + (r.end || "—") + " | " + r.stage + " |"); });
    }
    L.push("");
    L.push("## JD 差距");
    if (!model.jdGaps.length) L.push("（还没有在招职位）");
    model.jdGaps.forEach(function (x) {
      L.push("### " + x.jd.title + "（" + (x.gap.level === "high" ? "门槛偏高" : x.gap.level === "watch" ? "需要关注" : "基本合理") + "）");
      L.push(x.gap.summary);
      if (x.gap.flags.length) x.gap.flags.forEach(function (f) { L.push("- " + f); });
      L.push("");
    });
    L.push("## 提醒摘要");
    if (!model.reminds.length) L.push("（没有未读提醒）");
    model.reminds.forEach(function (n) { L.push("- " + n.title + "：" + n.desc); });
    L.push("");
    L.push("## 建议动作");
    model.actions.forEach(function (a, i) { L.push((i + 1) + ". " + a); });
    L.push("");
    L.push("## 口径与来源");
    model.source.notices.forEach(function (n) { L.push("- " + n.title + "（" + (n.org || "") + " · " + (n.published || "") + "）"); });
    L.push("- " + model.source.fieldNote);
    L.push("- 生成时间 " + model.source.generatedAt);
    return L.join("\n");
  }

  function briefStandalone(model) {
    var css =
      'body{margin:0;padding:32px 28px;background:#F6F6F3;color:#111318;font:15px/1.7 "PingFang SC","Microsoft YaHei",system-ui,sans-serif}' +
      ".bf-sheet{max-width:780px;margin:0 auto;background:#fff;border:1px solid #E6E6E0;border-radius:12px;padding:34px 36px;box-shadow:0 1px 2px rgba(17,19,24,.05)}" +
      ".bf-brand{font:600 11px/1.4 ui-monospace,Consolas,monospace;letter-spacing:.18em;color:#C8451C;text-transform:uppercase}" +
      ".bf-hd h1{font-size:26px;margin:8px 0 4px}.bf-sub{margin:0;color:#686D76;font-size:12px}" +
      "h2{font-size:15px;margin:22px 0 8px;padding-bottom:5px;border-bottom:1px solid #E6E6E0}" +
      ".bf-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:16px}" +
      ".bf-kpi{border:1px solid #E6E6E0;border-radius:9px;padding:9px 11px;background:#FBFBF8}" +
      ".bf-kpi span{font:10px/1 ui-monospace,Consolas,monospace;letter-spacing:.14em;color:#686D76}" +
      ".bf-kpi b{display:block;font:600 20px/1.2 ui-monospace,Consolas,monospace;margin-top:6px}" +
      ".bf-kpi small{display:block;font-size:10px;color:#686D76;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".bf-note{color:#686D76;font-size:11.5px;margin:6px 0}" +
      ".bf-bars{display:grid;grid-template-columns:1fr 1fr;gap:12px 20px;margin:8px 0 4px}" +
      ".bf-barblock b{display:block;font-size:11px;color:#33373E;margin-bottom:5px}" +
      ".bf-bar{display:grid;grid-template-columns:70px 1fr 38px;align-items:center;gap:6px;margin:3px 0}" +
      ".bf-bar-l{font-size:10.5px;color:#33373E;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".bf-bar i{display:block;height:7px;border-radius:3px;background:#C8451C;opacity:.75;min-width:2px}" +
      ".bf-bar-v{font:10px/1 ui-monospace,Consolas,monospace;color:#686D76;text-align:right}" +
      ".bf-table{width:100%;border-collapse:collapse;font-size:11.5px}" +
      ".bf-table th{text-align:left;font:10px/1 ui-monospace,Consolas,monospace;letter-spacing:.1em;color:#686D76;padding:6px 6px;border-bottom:1px solid #E6E6E0}" +
      ".bf-table td{padding:6px;border-bottom:1px solid #EFEFEA;vertical-align:top}" +
      ".bf-table td small{display:block;color:#686D76;font-size:10px}" +
      ".bf-gap{border:1px solid #E6E6E0;border-left:3px solid #686D76;border-radius:8px;padding:10px 12px;margin:8px 0}" +
      ".bf-gap.high{border-left-color:#C8451C}.bf-gap.watch{border-left-color:#8A5A0F}" +
      ".bf-gap-hd{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.bf-gap-hd b{font-size:13px}" +
      ".bf-gap-hd span{font-size:10.5px;color:#686D76}" +
      ".bf-lv{margin-left:auto;font:10px/1 ui-monospace,Consolas,monospace;letter-spacing:.08em;padding:3px 6px;border-radius:4px;background:#F6F6F3;color:#8A5A0F;font-style:normal}" +
      ".bf-lv.high{color:#C8451C}.bf-gap-sum{font-size:11.5px;margin:6px 0 4px}" +
      ".bf-flags{margin:0;padding-left:18px}.bf-flags li{font-size:11px;color:#33373E;margin:2px 0}" +
      ".bf-remind{padding-left:18px;margin:0}.bf-remind li{font-size:11.5px;margin:4px 0}.bf-remind span{display:block;color:#686D76;font-size:10.5px}" +
      ".bf-actions{margin:0;padding-left:20px}.bf-actions li{font-size:12px;margin:4px 0}" +
      ".bf-src{padding-left:18px;margin:0}.bf-src li{font-size:10.5px;color:#686D76;margin:3px 0}.bf-src .bf-gen{color:#8A8F99}" +
      ".bf-empty{font-size:11.5px;color:#686D76;border:1px dashed #E6E6E0;border-radius:8px;padding:10px}" +
      "@media print{body{padding:0;background:#fff}.bf-sheet{border:0;box-shadow:none;border-radius:0;max-width:none;padding:0}.bf-kpis{grid-template-columns:repeat(4,1fr)}.bf-bars{grid-template-columns:1fr 1fr}}";
    return "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
      "<title>" + esc(model.title) + " · " + esc(model.date) + "</title><style>" + css + "</style></head><body>" +
      briefHTML(model) + "</body></html>";
  }

  var _model = null;
  function getModel(opts) {
    if (opts && (opts.force || !_model)) _model = briefModel(opts);
    return _model;
  }
  function invalidate() { _model = null; }

  HR.brief = {
    sections: BRIEF_SECTIONS,
    model: briefModel,
    preset: getModel,
    invalidate: invalidate,
    html: briefHTML,
    markdown: briefMD,
    standalone: briefStandalone
  };
})();
