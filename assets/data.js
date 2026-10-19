/* =====================================================================
   数据层：示例数据 + 口径派生（由 assets/data.js 提供）
   ---------------------------------------------------------------------
   window.STARTA = {
     DATA, NOTICES, NOTICE_ROLES, TYPES, META,
     today(), daysLeft(str), kpis(), unitsOf(), majors(), edus(), skillStats()
   }

   口径说明：
   - META.totalJobs = 147 是「库里总量」；META.sample = 24 是页面展示的样本行数，
     也就是 DATA.length。kpis() 用 open(=DATA.length, 24) 与 total(=147) 两个字段
     把「样本 / 全库」这层差异表达出来，页面上应显示成「显示 24 / 147」。
   - META.snapshot 是示例库的快照标识，只作文案展示，**不参与**天数计算；
     所有「剩几天」一律相对 today()（真实当天 00:00）。
   - 紧迫截止行与 added 字段以加载当天为基准生成（仍输出 MM-DD），
     这样 urgent7 / weekNew 不会随着运行日期漂移失效。
   ===================================================================== */
window.STARTA = (function(){
  const META = { snapshot:"2026-11-02", totalJobs:147, sample:24 };

  /* ---------- 日期口径 ---------- */
  /* 真实当天 00:00（本地时区），不再写死 2026-11-02 */
  function today(){
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }
  function pad2(n){ return String(n).padStart(2, "0"); }
  /* 以今天为基准偏移 offset 天，输出 MM-DD */
  function md(offset){
    const t = today();
    t.setDate(t.getDate() + offset);
    return pad2(t.getMonth() + 1) + "-" + pad2(t.getDate());
  }
  /* 把 MM-DD 落到「离今天最近的那一年」，跨年（12 月 ↔ 1 月）也不会算反 */
  function mdToDate(str){
    const m = /(\d{1,2})-(\d{1,2})/.exec(str ? String(str) : "");
    if (!m) return null;
    const base = today();
    const y = base.getFullYear();
    let d = new Date(y, Number(m[1]) - 1, Number(m[2]));
    const gap = Math.round((d - base) / 86400000);
    if (gap > 183) d = new Date(y - 1, Number(m[1]) - 1, Number(m[2]));
    else if (gap < -183) d = new Date(y + 1, Number(m[1]) - 1, Number(m[2]));
    return d;
  }
  /* 距 today 的天数；「长期」或无日期 → null */
  function daysLeft(str){
    const d = mdToDate(str);
    if (!d) return null;
    return Math.round((d - today()) / 86400000);
  }

  /* ---------- 岗位样本（24 条） ----------
     字段：t 性质 / u 单位 / r 岗位 / m 专业 / mf 专业大类 / e 学历 / x 经验 /
           n 名额 / d 截止 / w 报名入口 / city 城市 / desc 岗位要求 / added 入库日
     d 说明：普通行是示例库里的固定截止日；下面 3 条标了「紧迫截止」的行用
           md(+3/+5/+6) 生成，保证 urgent7 恒为 3（公务员岗位不动）。 */
  const DATA = [
  {t:"央企",u:"国家电网",r:"变电运维",m:"电气工程及自动化",mf:"电气",e:"本科",x:"应届",n:12,d:"11-28",w:"国聘网 · 校招",city:"全国",added:md(-20),desc:"负责 220kV 及以下变电站设备巡视、倒闸操作与缺陷记录；需懂继电保护基础，接受轮班与驻站。"},
  {t:"央企",u:"中国石油",r:"财务核算",m:"会计学 / 财务管理",mf:"财会",e:"本科",x:"1-3 年",n:4,d:md(3),w:"官网 · 社招",city:"北京",added:md(-6),desc:"集团合并报表与成本核算，需熟悉新收入准则；有事务所经验优先，要求 CPA 科目通过。"},
  {t:"央企",u:"中国移动",r:"数据分析",m:"统计学 / 计算机",mf:"计算机",e:"硕士",x:"应届",n:6,d:"11-30",w:"国聘网 · 校招",city:"杭州",added:md(-18),desc:"经营分析与用户增长建模，SQL 与 Python 为硬门槛，需能独立产出归因报告。"},
  {t:"央企",u:"中建三局",r:"土建工程师",m:"土木工程",mf:"土木",e:"本科",x:"3-5 年",n:5,d:"12-12",w:"官网 · 社招",city:"武汉",added:md(-26),desc:"房建项目现场技术管理，需有一级建造师或同岗经验，能接受项目地调动。"},
  {t:"央企",u:"国家能源",r:"集控运行",m:"热能与动力工程",mf:"能源",e:"本科",x:"应届",n:10,d:"11-29",w:"国聘网 · 校招",city:"银川",added:md(-30),desc:"火电机组集控巡检与运行调整，四班三倒；热动、自动化专业优先。"},
  {t:"事业单位",u:"市第一人民医院",r:"临床医师",m:"临床医学",mf:"医学",e:"硕士",x:"应届",n:25,d:"11-25",w:"市卫健委 · 统考",city:"本地",added:md(-22),desc:"住院医师规范化培训合格者优先；岗位表与专业限制写在公告 XLSX 附件里，需逐条核对。"},
  {t:"事业单位",u:"省属高校",r:"专职辅导员",m:"不限（中共党员）",mf:"不限",e:"硕士",x:"应届",n:8,d:"12-01",w:"人事考试网",city:"省会",added:md(-3),desc:"负责学生日常管理与思政工作，须为中共党员，需住校值班。"},
  {t:"事业单位",u:"市疾控中心",r:"检验技师",m:"医学检验技术",mf:"医学",e:"本科",x:"1-3 年",n:5,d:"12-09",w:"人事考试网",city:"本地",added:md(-19),desc:"理化与微生物检验，需持检验技师资格证；有 PCR 实验室经验优先。"},
  {t:"事业单位",u:"市图书馆",r:"读者服务",m:"图书馆学 / 汉语言",mf:"文科",e:"本科",x:"不限",n:3,d:md(5),w:"人事考试网",city:"本地",added:md(-28),desc:"借阅服务与阅读推广，需轮班含周末；有活动策划经验者优先。"},
  {t:"国企",u:"市城投集团",r:"投融资专员",m:"金融学 / 经济学",mf:"金融",e:"硕士",x:"3-5 年",n:2,d:"12-08",w:"市国资委官网",city:"本地",added:md(-24),desc:"负责债券发行与项目融资测算，需熟悉地方政府投融资平台监管口径。"},
  {t:"国企",u:"地铁集团",r:"运营调度",m:"交通运输",mf:"交通",e:"本科",x:"应届",n:15,d:"11-26",w:"官网 · 校招",city:"本地",added:md(-5),desc:"行车调度与应急指挥，需通过体检与心理测评，倒班制。"},
  {t:"国企",u:"交投集团",r:"法务岗",m:"法学（过法考）",mf:"法学",e:"本科",x:"1-3 年",n:1,d:"12-03",w:"官网 · 社招",city:"本地",added:md(-27),desc:"合同审核与诉讼管理，须通过法律职业资格考试；党员优先。"},
  {t:"民营",u:"新能源科技",r:"算法工程师",m:"计算机 / 自动化",mf:"计算机",e:"硕士",x:"1-3 年",n:5,d:"长期",w:"官网 · 招聘平台",city:"深圳",added:md(-1),desc:"储能 BMS 算法与数据建模，要求有落地项目；薪资区间写在 JD 正文，常年开放。"},
  {t:"民营",u:"智能制造",r:"供应链计划",m:"物流管理 / 工业工程",mf:"管理",e:"本科",x:"3-5 年",n:2,d:"长期",w:"官网",city:"苏州",added:md(-32),desc:"主生产计划与物料齐套，需熟练 ERP；制造业计划岗 3 年以上经验。"},
  {t:"公务员",u:"区市场监管局",r:"行政执法",m:"法学 / 食品科学",mf:"法学",e:"本科",x:"不限",n:3,d:"11-20",w:"国家公务员局",city:"本地",added:md(-14),desc:"基层执法岗位，需通过体能测试；专业限制写在职位表备注栏，报名窗口极短。"},
  {t:"公务员",u:"税务局",r:"一级行政执法员",m:"财会 / 审计",mf:"财会",e:"本科",x:"不限",n:12,d:"11-20",w:"国考专题页",city:"全国",added:md(-13),desc:"税收征管一线岗位，需参加国考笔试与面试；应届与在职均可，专业以职位表为准。"},
  {t:"外企",u:"汽车零部件",r:"质量工程师",m:"机械 / 材料",mf:"机械",e:"本科",x:"3-5 年",n:2,d:md(6),w:"LinkedIn",city:"上海",added:md(-2),desc:"IATF 16949 体系维护与客户质量投诉处理，英语可作为工作语言。"},
  {t:"外企",u:"医疗器械",r:"注册专员",m:"生物医学工程",mf:"医学",e:"本科",x:"1-3 年",n:1,d:"12-10",w:"官网",city:"北京",added:md(-21),desc:"NMPA 注册资料撰写与审评沟通，需熟悉二类器械注册流程，英语读写熟练。"},
  {t:"央企",u:"国家电网",r:"调度运行",m:"电气工程及自动化",mf:"电气",e:"本科",x:"应届",n:6,d:"11-28",w:"国聘网 · 校招",city:"全国",added:md(-11),desc:"省级调度中心值班岗，需掌握电网潮流计算与继电保护，四班三倒。"},
  {t:"央企",u:"国家电网",r:"信息通信",m:"通信工程 / 计算机",mf:"计算机",e:"本科",x:"应届",n:4,d:"12-05",w:"国聘网 · 校招",city:"全国",added:md(-9),desc:"电力通信网运维与网络安全，需熟悉 SDH 传输与调度数据网。"},
  {t:"事业单位",u:"市第一人民医院",r:"护理",m:"护理学",mf:"医学",e:"专科",x:"应届",n:30,d:"12-09",w:"市卫健委 · 统考",city:"本地",added:md(-17),desc:"临床护理岗，合同制不占编制，需已取得或当年通过护士执业资格。"},
  {t:"事业单位",u:"市第一人民医院",r:"医学检验",m:"医学检验技术",mf:"医学",e:"本科",x:"1-3 年",n:6,d:"12-10",w:"市卫健委 · 统考",city:"本地",added:md(-16),desc:"检验科常规与生化检验，需持检验技师资格证，能独立值班。"},
  {t:"事业单位",u:"省属高校",r:"专任教师（计算机）",m:"计算机科学与技术",mf:"计算机",e:"博士",x:"不限",n:5,d:"12-15",w:"人事考试网",city:"省会",added:md(-23),desc:"教学科研岗，博士学历可免笔试直接面试，需有 SCI 或 CCF 论文。"},
  {t:"事业单位",u:"省属高校",r:"实验技术",m:"材料 / 化学",mf:"理科",e:"硕士",x:"应届",n:3,d:"12-08",w:"人事考试网",city:"省会",added:md(-25),desc:"实验室仪器管理与实验课支撑，需熟悉 SEM、XRD 等设备操作。"}
  ];

  /* ---------- 公告（13 条）与岗位映射 ----------
     发布日期同样以 today() 为基准生成（最近一条 = 今天），避免出现「已同步日期早于公告发布日期」的穿越感；
     页面渲染时由 app.js 拼接当年年份，所以这里只输出 MM-DD。 */
  const NOTICES = [
  {id:"n1",u:"国家电网",title:"2026 年第二批高校毕业生招聘公告",src:"zhaopin.sgcc.com.cn/notice/2026-1102.html",date:md(0),st:"parsed",files:2,
    sum:"本次招聘面向 2026 届高校毕业生，开放变电运维、信息通信等专业方向共 16 个名额。统一网上报名，笔试为全国机考，面试由各省公司分别组织，录用后签订正式劳动合同。"},
  {id:"n2",u:"市第一人民医院",title:"2026 年公开招聘工作人员（编制）公告",src:"wjw.example.gov.cn/2026/1101.html",date:md(-1),st:"parsed",files:3,
    sum:"市卫健委统一组织，招聘临床医师、医技等岗位，纳入事业编制管理。报名后需参加公共科目笔试与专业技能测试，面试按 1:3 比例确定人选。"},
  {id:"n3",u:"省属高校",title:"专职辅导员公开招聘（第二批）",src:"hrd.example.gov.cn/2026/1031.html",date:md(-2),st:"parsed",files:1,
    sum:"面向硕士研究生招聘专职辅导员 8 名，要求中共党员（含预备党员）。考试分为笔试、面试与心理测评，录用后纳入事业单位人事管理。"},
  {id:"n4",u:"税务局",title:"2027 年度考试录用公务员职位表",src:"scs.gov.cn/2026/1029.html",date:md(-4),st:"parsed",files:1,
    sum:"国考职位表，本岗位属行政执法类，限财会、审计相关专业，本科及以上。报名期窗口固定，只有一次机会，错过只能等下一年度。"},
  {id:"n5",u:"中国移动",title:"2027 届秋季校园招聘启动",src:"job.10086.cn/2026/1028.html",date:md(-5),st:"parsed",files:1,
    sum:"秋招提前批，面向统计、计算机类专业招聘数据分析岗，硕士优先。流程为网申、线上笔试、两轮面试，offer 集中在 12 月发放。"},
  {id:"n6",u:"市城投集团",title:"2026 年社会化公开招聘简章",src:"gzw.example.gov.cn/2026/1027.html",date:md(-6),st:"parsed",files:2,
    sum:"市属国企平台公司招聘投融资相关岗位，要求 3–5 年相关经验。笔试考公共基础与专业知识，面试采用结构化形式。"},
  {id:"n7",u:"地铁集团",title:"运营分公司招聘（调度、站务）",src:"metro.example.cn/2026/1026.html",date:md(-7),st:"parsed",files:1,
    sum:"运营分公司补员招聘，调度岗需交通运输类专业。需通过体检与安全背景审查，录用后倒班作业。"},
  {id:"n8",u:"新能源科技",title:"储能算法与数据团队常年招聘",src:"careers.example.com/2026/1025.html",date:md(-8),st:"parsed",files:0,
    sum:"民营企业常年滚动招聘，算法工程师要求计算机、自动化相关专业，1–3 年经验。流程快，技术面两轮即可定薪，长期在线接收简历。"},
  {id:"n9",u:"市疾控中心",title:"2026 年检验技师招聘公告",src:"wsjkw.example.gov.cn/2026/1024.html",date:md(-9),st:"parsed",files:2,
    sum:"疾控中心招聘检验技师 5 名，医学检验技术专业本科及以上。考试含专业笔试与实操考核，需具备相应资格证书。"},
  {id:"n10",u:"中国石油",title:"财务共享中心社会招聘",src:"hr.cnpc.com.cn/2026/1023.html",date:md(-10),st:"pending",files:0,
    sum:""},
  {id:"n11",u:"国家电网",title:"2027 届校园招聘提前批（电工类）",src:"zhaopin.sgcc.com.cn/notice/2026-1021.html",date:md(-12),st:"parsed",files:2,
    sum:"提前批只面向电工类专业，名额比统招少但流程快。笔试提前到 12 月，签约后不再参加春季批次。"},
  {id:"n12",u:"市第一人民医院",title:"2026 年护理人员招聘（合同制）",src:"wjw.example.gov.cn/2026/1018.html",date:md(-15),st:"parsed",files:1,
    sum:"合同制护理岗位，招聘 30 人，专科及以上可报。只考专业实操与面试，录用后与医院直签，不占编制。"},
  {id:"n13",u:"省属高校",title:"2027 年教师岗位公开招聘预告",src:"hrd.example.gov.cn/2026/1015.html",date:md(-18),st:"parsed",files:1,
    sum:"预告性质，正式公告预计 12 月发布。博士学历可直接进入面试环节，硕士需先通过统一笔试。岗位与截止以正式公告为准。"}
  ];

  /* 公告 → 该公告点名的岗位（必须能在 DATA 里按「单位 + 岗位名」找到）。
     没列到的公告会兜底成该单位的全部岗位，所以这里只写公告明确提到的。 */
  const NOTICE_ROLES = {
  n1:["变电运维","信息通信"],
  n2:["临床医师","医学检验"],
  n3:["专职辅导员"],
  n4:["一级行政执法员"],
  n5:["数据分析"],
  n6:["投融资专员"],
  n7:["运营调度"],
  n8:["算法工程师"],
  n9:["检验技师"],
  n10:["财务核算"],
  n11:["调度运行"],
  n12:["护理"],
  n13:["专任教师（计算机）","实验技术"]
  };

  /* ---------- 维度 ---------- */
  /* 单位性质；首项「全部」供筛选条直接用 */
  const TYPES = ["全部","央企","国企","事业单位","公务员","民营","外企"];

  /* 学历排序权重，筛选下拉按这个顺序展示 */
  const EDU_ORDER = ["专科","本科","硕士","博士","不限"];

  /* ---------- 派生口径 ---------- */
  /* KPI：open 是「页面样本在招数」，total 是「库里总量」，两者差异必须在 UI 上体现 */
  function kpis(){
    const units = new Set(DATA.map(d => d.u)).size;
    const urgent7 = DATA.filter(d => {
      const left = daysLeft(d.d);
      return left !== null && left >= 0 && left <= 7;
    }).length;
    const weekNew = DATA.filter(d => {
      const age = daysLeft(d.added);
      return age !== null && age >= -7 && age <= 0;
    }).length;
    return { open:DATA.length, total:META.totalJobs, units, urgent7, weekNew };
  }

  /* 单位聚合，按岗位数降序；一家单位一条 */
  function unitsOf(){
    const map = new Map();
    DATA.forEach(d => {
      if (!map.has(d.u)) map.set(d.u, { u:d.u, t:d.t, city:d.city, n:0, roles:[] });
      const row = map.get(d.u);
      row.n += 1;
      row.roles.push(d.r);
    });
    return Array.from(map.values()).sort((a, b) => b.n - a.n || a.u.localeCompare(b.u, "zh"));
  }

  /* 专业大类去重，首项为「全部专业」哨兵，可直接灌进筛选下拉 */
  function majors(){
    const seen = [];
    DATA.forEach(d => { if (!seen.includes(d.mf)) seen.push(d.mf); });
    return ["全部专业"].concat(seen);
  }

  /* 学历去重，按 专科 → 本科 → 硕士 → 博士 排序，首项为「全部学历」哨兵 */
  function edus(){
    const seen = new Set(DATA.map(d => d.e));
    return ["全部学历"].concat(EDU_ORDER.filter(e => seen.has(e)));
  }

  /* 技能剖面口径：v = 24 条样本里命中该规则的岗位数（不是全库 147 的推算值）。
     改 DATA 会跟着变，页面上的占比由 app.js 用 v / META.sample 或 v / 最大值画条。 */
  const SKILL_RULES = [
  { k:"SQL / 数据分析", re:/sql|python|数据分析|统计|建模|归因|经营分析/i },
  { k:"电气 / 能源调度", re:/电气|电网|变电|继电|潮流|调度|通信|机组|集控|sdh/i },
  { k:"财务 / 投融资", re:/财务|会计|审计|核算|报表|税务|融资|cpa/i },
  { k:"临床 / 护理医技", re:/临床|护理|医师|检验|药学|药师|pcr|影像/i },
  { k:"法律 / 合规风控", re:/法学|法务|法律|诉讼|法考|合规/i },
  { k:"机械 / 材料质量", re:/机械|材料|质量|iatf|sem|xrd/i },
  { k:"硕士及以上", field:"e", re:/^(硕士|博士)$/ },
  { k:"党员要求", re:/党员/ },
  { k:"应届可投", field:"x", re:/^应届$/ }
  ];

  function skillStats(list){
    const src = Array.isArray(list) ? list : DATA;
    return SKILL_RULES.map(rule => ({
      k:rule.k,
      v:src.filter(d => {
        if (rule.field === "e") return rule.re.test(d.e);
        if (rule.field === "x") return rule.re.test(d.x);
        const hay = `${d.r} ${d.m} ${d.mf} ${d.desc} ${d.x}`;
        return rule.re.test(hay);
      }).length
    }));
  }

  return { DATA, NOTICES, NOTICE_ROLES, TYPES, META, today, daysLeft, kpis, unitsOf, majors, edus, skillStats };
})();
