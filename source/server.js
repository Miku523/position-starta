/**
 * 招聘公告采集台
 * ---------------------------------------------------------------
 * 引擎 A（默认）lexmount：Lexmount 云浏览器。每次运行 = 一个云 Session，
 *   有 session_id / 区域 / 控制台回放地址，这就是可核验材料。
 * 引擎 B local：本机 Chrome（CDP），无凭证时的退路。
 *
 * 流程：开页 → 提取 → 下载附件 → 解析（xlsx / pdf）→ 落盘 → 关 Session
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, spawn } = require('child_process');

const PORT = 8901;
const ROOT = __dirname;
const SHOTS = path.join(ROOT, 'shots');
const RUNS = path.join(ROOT, 'runs');
const DL = path.join(ROOT, 'downloads');
[SHOTS, RUNS, DL].forEach((d) => fs.mkdirSync(d, { recursive: true }));

/* pdftotext 必须固定用这版：不同构建的 -layout 空格输出不同，会让列对齐整体走样。
   bin/pdftotext 里放了一份 xpdf 4.06（静态链接，无依赖）。 */
const PDFTOTEXT = [
  path.join(ROOT, 'bin', 'pdftotext', 'pdftotext.exe'),
  'pdftotext',
].find((p) => p === 'pdftotext' || fs.existsSync(p));

/* ---------------- 凭证与环境 ---------------- */
function loadEnvFile() {
  const env = { ...process.env };
  const p = path.join(os.homedir(), '.dsh', 'skills', 'lexmount-webfetch', '.env');
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
      if (m && !env[m[1]]) env[m[1]] = m[2];
    }
  }
  return env;
}
const ENV = loadEnvFile();
const CLI = path.join(ROOT, 'bin', 'browser-cli.exe');

function cli(args, timeout = 180000) {
  return new Promise((resolve, reject) => {
    execFile(CLI, args, { env: ENV, maxBuffer: 64 * 1024 * 1024, windowsHide: true, timeout }, (err, so, se) => {
      if (err && !so) return reject(new Error((se || err.message || 'cli failed').toString().slice(0, 400)));
      let j = null;
      try { j = JSON.parse(so); } catch { /* 非 JSON 输出 */ }
      resolve(j || { ok: false, raw: (so || '').slice(0, 2000), stderr: (se || '').slice(0, 500) });
    });
  });
}

/* ---------------- 页面内提取 ---------------- */
const EXTRACT_JS = `(() => {
  const abs = (h) => { try { return new URL(h, location.href).href; } catch { return h; } };
  const txt = (document.body.innerText || '').replace(/\\r/g, '');
  const lines = txt.split('\\n').map(s => s.trim()).filter(Boolean);
  const files = [...document.querySelectorAll('a[href]')]
    .map(a => ({ name: (a.textContent || '').trim().slice(0, 80), href: abs(a.getAttribute('href')) }))
    .filter(f => /\\.(pdf|docx?|xlsx?|zip|rar|wps)(\\?|$)/i.test(f.href));
  const KW = /(岗位|职位|招聘\\s*\\d+|人数|专业|学历|任职要求|岗位职责|工作经验|技能)/;
  const hits = lines.filter(l => KW.test(l) && l.length < 120).slice(0, 40);
  const tables = [...document.querySelectorAll('table')].map(t => {
    const rows = [...t.querySelectorAll('tr')].map(tr =>
      [...tr.querySelectorAll('th,td')].map(td => (td.innerText || '').trim().replace(/\\s+/g, ' ')));
    return rows.filter(r => r.some(c => c));
  }).filter(t => t.length > 1);
  return {
    title: (document.title || '').trim(),
    h1: (document.querySelector('h1')?.innerText || '').trim(),
    url: location.href,
    lineCount: lines.length,
    charCount: txt.length,
    files, hits, tables,
    links: [...document.querySelectorAll('a[href]')].map(a => ({ t: (a.textContent || '').trim().slice(0, 60), h: abs(a.getAttribute('href')) })),
    pubDate: (txt.match(/20\\d{2}\\s*[-年./]\\s*\\d{1,2}\\s*[-月./]\\s*\\d{1,2}/) || [''])[0]
  };
})()`;

/* ---------------- 引擎 A：Lexmount 云 ---------------- */
async function lexmountGrab(sid, url, log, tag = '') {
  const opened = await cli(['action', 'open-url', '--session-id', sid, '--url', url, '--timeout-ms', '45000']);
  if (!opened.ok) throw new Error('打开页面失败：' + JSON.stringify(opened).slice(0, 200));
  log(`${tag}已打开：` + ((opened.data && opened.data.title) || '').slice(0, 56));

  const ev = await cli(['action', 'eval', '--session-id', sid, '--expression', EXTRACT_JS]);
  if (!ev.ok) throw new Error('提取失败：' + JSON.stringify(ev).slice(0, 200));
  let data = ev.data;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { data = { title: String(data).slice(0, 80) }; } }
  data = data || {};
  log(`${tag}提取：${data.charCount || 0} 字 / ${(data.files || []).length} 附件 / ${(data.tables || []).length} 表`);

  const shotName = 'cloud-' + Date.now() + Math.floor(Math.random() * 1000) + '.png';
  const shot = await cli(['action', 'screenshot', '--session-id', sid, '--path', path.join(SHOTS, shotName), '--full-page']);
  if (shot.ok) { data.shot = '/shots/' + shotName; log(`${tag}截图已存（云端）`); }
  return data;
}

async function engineLexmount(url, log, opts = {}) {
  const t0 = Date.now();
  const created = await cli(['session', 'create', '--browser-mode', 'normal', '--timeout-seconds', '600', '--recording']);
  if (!created.ok) throw new Error('创建云 Session 失败：' + JSON.stringify(created).slice(0, 300));
  const s = created.data;
  const sid = s.session_id;
  log(`云 Session 已建 ${sid} · 区域 ${s._source_region_id || s.region_id}`);
  if (s.inspect_url) log('实时画面：' + s.inspect_url);

  try {
    const data = await lexmountGrab(sid, url, log);
    data.session = {
      id: sid,
      region: s._source_region_id || s.region_id,
      inspect: s.inspect_url || null,
      replay: s.inspect_url ? s.inspect_url.replace('/browser_dev/index.html', '/browser_dev/index_dbg.html') : null,
    };

    if (opts.expand) {
      const links = pickDetailLinks(data, url);
      /* 只有「像列表页」才展开：本页没有附件、正文很短、候选链接够多。
         详情页常会带几条「相关公告」，不加这道闸会把它们误当子页面。 */
      const listLike = !(data.files || []).length && (data.charCount || 0) < 4000 && links.length >= 4;
      if (links.length && listLike) {
        const conc = Math.max(1, Math.min(3, Number(opts.concurrency) || 3));
        const picked = links.slice(0, Math.max(1, Number(opts.maxChildren) || 5));
        data.children = [];
        data.failures = [];
        log(`识别为列表页，${conc} 个并发 Session 展开 ${picked.length} 条详情`);

        const slots = await Promise.all(Array.from({ length: Math.min(conc, picked.length) }, async (_, i) => {
          const c = await cli(['session', 'create', '--browser-mode', 'normal', '--timeout-seconds', '900', '--recording']);
          if (!c.ok) return null;
          log(`  并发通道 ${i + 1} 就绪：${c.data.session_id.slice(0, 16)}…`);
          return c.data;
        }));

        await pool(picked, conc, async (l, i, slot) => {
          const s = slots[slot];
          const t0 = Date.now();
          if (!s) { data.failures.push({ url: l.url, title: l.title, error: '并发通道创建失败' }); return; }
          try {
            const child = await withRetry(() => lexmountGrab(s.session_id, l.url, log, `  [${i + 1}] `), 2, log, `  [${i + 1}] `);
            data.children.push({
              ...child, listTitle: l.title, ms: Date.now() - t0,
              session: { id: s.session_id, region: s._source_region_id || s.region_id, inspect: s.inspect_url || null },
            });
          } catch (e) {
            data.failures.push({ url: l.url, title: l.title, error: e.message });
            log(`  [${i + 1}] 最终失败：${e.message}`);
          }
        });

        await Promise.all(slots.filter(Boolean).map((s) => cli(['session', 'close', '--session-id', s.session_id]).catch(() => null)));
        data.children.sort((a, b) => picked.findIndex((p) => p.url === a.url) - picked.findIndex((p) => p.url === b.url));
        if (data.failures.length) log(`展开完成：成功 ${data.children.length}，失败 ${data.failures.length}`);
      } else log('没有识别出详情链接，按详情页处理');
    }

    data.engine = 'lexmount';
    data.ms = Date.now() - t0;
    return data;
  } finally {
    const closed = await cli(['session', 'close', '--session-id', sid]).catch(() => ({ ok: false }));
    log(closed.ok ? `云 Session 已关闭（录像保留）：${sid}` : `关会话异常：${sid}`);
  }
}

/* ---------------- 引擎 B：本机 Chrome (CDP) ---------------- */
function browserWs() {
  const p = path.join(os.homedir(), 'AppData', 'Local', 'ego-lite-linux', 'browser.json');
  return JSON.parse(fs.readFileSync(p, 'utf8')).wsUrl;
}
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0; const pend = new Map(); const listeners = new Map();
    ws.addEventListener('open', () => resolve(api));
    ws.addEventListener('error', (e) => reject(new Error('CDP 连接失败: ' + (e.message || 'error'))));
    ws.addEventListener('message', (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && pend.has(msg.id)) {
        const { res, rej } = pend.get(msg.id); pend.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      } else if (msg.method) (listeners.get(msg.method) || []).forEach((f) => f(msg.params));
    });
    function send(method, params = {}, sessionId) {
      const mid = ++id; const payload = { id: mid, method, params };
      if (sessionId) payload.sessionId = sessionId;
      ws.send(JSON.stringify(payload));
      return new Promise((res, rej) => {
        pend.set(mid, { res, rej });
        setTimeout(() => { if (pend.has(mid)) { pend.delete(mid); rej(new Error('CDP 超时: ' + method)); } }, 45000);
      });
    }
    const api = { send, close: () => ws.close(), on: (m, f) => { const a = listeners.get(m) || []; a.push(f); listeners.set(m, a); } };
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function engineLocal(url, log) {
  const t0 = Date.now();
  const ws = await connect(browserWs());
  log('已连接本机浏览器（CDP）');
  const { targetId } = await ws.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await ws.send('Target.attachToTarget', { targetId, flatten: true });
  await ws.send('Page.enable', {}, sessionId);
  await ws.send('Runtime.enable', {}, sessionId);
  await ws.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  await ws.send('Page.navigate', { url }, sessionId);
  log('导航中 → ' + url);
  await new Promise((resolve) => { ws.on('Page.loadEventFired', () => resolve()); setTimeout(resolve, 20000); });
  await sleep(2000);
  const r = await ws.send('Runtime.evaluate', { expression: EXTRACT_JS, returnByValue: true, awaitPromise: true }, sessionId);
  const data = (r.result && r.result.value) || {};
  log(`提取完成：${data.charCount || 0} 字，${(data.files || []).length} 个附件`);
  try {
    const m = await ws.send('Page.getLayoutMetrics', {}, sessionId);
    const cs = m.cssContentSize || m.contentSize;
    const png = await ws.send('Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: Math.ceil(cs.width), height: Math.min(Math.ceil(cs.height), 6000), scale: 0.6 } },
      sessionId);
    const name = 'local-' + Date.now() + '.png';
    fs.writeFileSync(path.join(SHOTS, name), Buffer.from(png.data, 'base64'));
    data.shot = '/shots/' + name;
    log('全页截图已存');
  } catch (e) { log('截图失败：' + e.message); }
  await ws.send('Target.closeTarget', { targetId });
  ws.close();
  data.engine = 'local';
  data.ms = Date.now() - t0;
  return data;
}

/* ---------------- 附件下载 ---------------- */
async function downloadFile(href, log) {
  const name = decodeURIComponent((href.split('/').pop() || 'file').split('?')[0]).replace(/[\\/:*?"<>|]/g, '_');
  const out = path.join(DL, name);
  if (fs.existsSync(out) && fs.statSync(out).size > 0) { log(`附件已在本地：${name}`); return { path: out, name, size: fs.statSync(out).size }; }
  const r = await fetch(href, {
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36' },
    redirect: 'follow',
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(out, buf);
  log(`已下载 ${name}（${(buf.length / 1024).toFixed(0)} KB）`);
  return { path: out, name, size: buf.length };
}

/* ---------------- xlsx 解析 ---------------- */
function unzipTo(zipPath, dir) {
  return new Promise((resolve, reject) => {
    // Windows 自带 bsdtar 会把盘符 "C:" 误判成远程主机，--force-local 强制按本地路径处理
    execFile('tar', ['--force-local', '-xf', zipPath, '-C', dir], { windowsHide: true }, (err, so, se) =>
      err ? reject(new Error(String(se || err.message).slice(0, 200))) : resolve());
  });
}
function readXlsx(filePath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-'));
  return unzipTo(filePath, tmp).then(() => {
    const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
    const sharedXml = read(path.join(tmp, 'xl', 'sharedStrings.xml'));
    const shared = [];
    let m; const siRe = /<si>([\s\S]*?)<\/si>/g;
    const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    while ((m = siRe.exec(sharedXml))) shared.push(unesc([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('')));
    const dir = path.join(tmp, 'xl', 'worksheets');
    const sheets = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.xml')).sort() : [];
    if (!sheets.length) throw new Error('xlsx 里没有 worksheet');
    const out = [];
    const wb = read(path.join(tmp, 'xl', 'workbook.xml'));
    const sheetNames = [...wb.matchAll(/<sheet\b[^>]*\bname="([^"]+)"/g)].map((x) => unesc(x[1]));
    for (const [si, sf] of sheets.slice(0, 6).entries()) {
      const xml = read(path.join(dir, sf));
      const colIdx = (ref) => {
        const mm = /^([A-Z]+)/.exec(ref || '');
        if (!mm) return null;
        let n = 0;
        for (const ch of mm[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
        return n - 1;
      };
      const cellText = (attrs, inner) => {
        const t = /t="([^"]+)"/.exec(attrs);
        if (t && (t[1] === 's' || t[1] === 'inlineStr')) {
          const is = /<is>([\s\S]*?)<\/is>/.exec(inner);
          if (is) return [...is[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('');
          const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
          if (t[1] === 's' && v) return shared[+v[1]] || '';
          return v ? v[1] : '';
        }
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
        return v ? v[1] : '';
      };
      /* 按单元格 r 属性定位列，空格子留空位（此前丢空格子会让后面的列整体左移） */
      const rawRows = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) => {
        const cells = [];
        const cre = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
        let cm;
        while ((cm = cre.exec(r[1]))) {
          const attrs = cm[1] || '';
          const inner = cm[2] || '';
          const ref = /\br="([A-Z]+\d+)"/.exec(attrs);
          const idx = ref ? colIdx(ref[1]) : cells.length;
          const val = String(cellText(attrs, inner)).replace(/\s+/g, ' ').trim();
          if (idx != null && idx >= 0) cells[idx] = val;
        }
        for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
        return cells;
      });
      const width = rawRows.reduce((a, r) => Math.max(a, r.length), 0);
      const rows = rawRows.map((r) => { const c = r.slice(); while (c.length < width) c.push(''); return c; });

      /* 表头：跳过只有一格的大标题行，取第一条「多格、短词、非纯数字」的行当表头 */
      let hi = 0;
      while (hi < rows.length && rows[hi].filter((c) => c).length < 2) hi++;
      const cand = rows[hi] || [];
      const filled = cand.filter((c) => c);
      const looksHeader = filled.length >= 3
        && filled.filter((c) => c.length <= 14).length >= Math.ceil(filled.length * 0.6)
        && filled.filter((c) => /^\d+$/.test(c)).length <= 1;
      const header = looksHeader ? cand : null;
      const body = looksHeader ? rows.slice(hi + 1) : rows;
      out.push({ sheet: sheetNames[si] || sf.replace(/\.xml$/, ''), rows: body, header, cols: width });
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    return out;
  });
}

/* ---------------- PDF 解析（pdftotext -layout） ---------------- */
function readPdf(filePath) {
  return new Promise((resolve, reject) => {
    execFile(PDFTOTEXT, ['-layout', '-enc', 'UTF-8', filePath, '-'], { maxBuffer: 64 * 1024 * 1024, windowsHide: true, timeout: 60000 },
      (err, so) => {
        if (err) return reject(new Error('pdftotext 失败: ' + err.message));
        const text = so.replace(/\r/g, '');
        const lines = text.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim());

        /* 1) 按「2 个以上空格」切单元格，记住每格起始列 */
        const split = (line) => {
          const cells = [], starts = [];
          const re = /\S(?:[^ ]| (?! ))*/g;
          let m;
          while ((m = re.exec(line))) { cells.push(m[0].trim()); starts.push(m.index); }
          return { cells, starts };
        };
        const raw = lines.map((l) => ({ line: l, ...split(l) })).filter((r) => r.cells.length >= 2);

        /* 2) 以出现最多的列数 M 为基准 */
        const hist = new Map();
        for (const r of raw) hist.set(r.cells.length, (hist.get(r.cells.length) || 0) + 1);
        const M = ([...hist.entries()].sort((a, b) => b[1] * b[0] - a[1] * a[0])[0] || [0])[0];

        /* 3) 用列数为 M 的行算出每列真实起始位置（中位数） */
        const ref = raw.filter((r) => r.cells.length === M);
        const bounds = Array.from({ length: M }, (_, i) => {
          const xs = ref.map((r) => r.starts[i]).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
          return xs.length ? xs[Math.floor(xs.length / 2)] : i * 20;
        });
        const nearestCol = (pos) => {
          let best = 0, bd = Infinity;
          bounds.forEach((b, i) => { const d = Math.abs(b - pos); if (d < bd) { bd = d; best = i; } });
          return best;
        };

        /* 4) 组装：多格合并、少格按列位置并回上一行 */
        const rows = [];
        for (const r of raw) {
          if (r.cells.length > M) {
            const cells = [...r.cells];
            while (cells.length > M && cells.length > 1) {
              let bi = 1, bg = Infinity;
              for (let i = 1; i < cells.length; i++) { const g = cells[i].length; if (g < bg) { bg = g; bi = i; } }
              cells[bi - 1] = (cells[bi - 1] + ' ' + cells[bi]).trim();
              cells.splice(bi, 1);
            }
            rows.push(cells);
          } else if (r.cells.length === M) {
            rows.push([...r.cells]);
          } else {
            const prev = rows[rows.length - 1];
            if (prev) {
              r.cells.forEach((c, i) => {
                const col = nearestCol(r.starts[i]);
                prev[col] = prev[col] ? prev[col] + ' ' + c : c;
              });
            } else rows.push([...r.cells]);
          }
        }

        /* 5) 表头识别：短格 + 关键词命中率高，才认 */
        const HDR = /(单位|岗位|学历|专业|人数|要求|名称|部门|编号|范围|条件|年龄|性别|备注|代码)/;
        const looksHeader = (row) => {
          if (!row || row.length < 2) return false;
          const hit = row.filter((c) => HDR.test(String(c))).length;
          const short = row.every((c) => String(c).length <= 14);
          return hit >= 2 && short && hit / row.length >= 0.5;
        };
        let hi = -1;
        for (let i = 0; i < Math.min(rows.length, 8); i++) {
          if (looksHeader(rows[i])) { hi = i; break; }
        }
        let header = hi >= 0 ? rows[hi] : null;

        /* 6) 掐掉正文开头的标题行：少列 + 有一格超长（合并格）＝标题／说明，不是记录 */
        const trimTitle = (arr) => {
          let i = 0;
          while (i < arr.length) {
            const ne = arr[i].filter(Boolean);
            const maxLen = ne.length ? Math.max(...ne.map((c) => String(c).length)) : 0;
            if (ne.length < M && maxLen > 24) i++; else break;
          }
          return arr.slice(i);
        };
        let body = trimTitle(hi >= 0 ? rows.slice(hi + 1) : rows)
          .filter((r) => !/(总计|合计|小计)/.test(r.join('')))
          /* 跨页重复表头：正文行里又出现表头前两格，直接丢 */
          .filter((r) => !(header && header[0] && r.join('').includes(String(header[0]).replace(/\s/g, ''))));

        /* 6b) 常见国标版式：表头少两列（序号/单位 合并进第一格、人数与要求挤在最后一格）。
              首格以数字开头 + 尾格以「数字 + 空格」开头，就给表头补一列并把尾格劈开。 */
        if (header && body.length >= 3) {
          const okFirst = body.filter((r) => /^\d+\s+\S/.test(String(r[0] || ''))).length / body.length >= 0.6;
          const okLast = body.filter((r) => /^\d+\s+\S/.test(String(r[r.length - 1] || ''))).length / body.length >= 0.6;
          if (okFirst && okLast) {
            header = ['序号 / 单位', ...header];
            body = body.map((r) => {
              const m = /^(\d+)\s+(.+)$/.exec(String(r[r.length - 1] || ''));
              return m ? [...r.slice(0, -1), m[1], m[2]] : r;
            });
          }
        }

        /* 7) 置信度：表头没识别 / 某一行把多个记录挤在一起 / 行数与列数明显不匹配 */
        const pages = (text.match(/\f/g) || []).length + 1;
        const charsPerPage = Math.round(text.length / Math.max(pages, 1));
        let conf = 'ok', why = '';
        if (charsPerPage < 30) { conf = 'low'; why = `疑似扫描件／图片型 PDF（${pages} 页共 ${text.length} 字，每页 ${charsPerPage} 字），没有文字层，需要 OCR`; }
        else if (!header) { conf = 'low'; why = '表头未识别，列名按 列1…列N 显示'; }
        const longest = body.reduce((a, r) => Math.max(a, r.join(' ').length), 0);
        const avg = body.length ? body.reduce((a, r) => a + r.join(' ').length, 0) / body.length : 0;
        if (!why && body.length && longest > avg * 4 && longest > 400) { conf = 'low'; why = '部分行把多条记录挤成一行，版式复杂'; }
        if (!why && M >= 6 && body.length > 30) { conf = 'low'; why = '宽表折行，列对齐可能错位'; }

        return resolve({ text, lines, rows, body, header, cols: M, chars: text.length, conf, why, pages, charsPerPage, scanned: charsPerPage < 30 });
      });
  });
}

/* ---------------- 并发工具 ---------------- */
async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async (_, slot) => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i, slot);
    }
  });
  await Promise.all(runners);
  return out;
}

async function withRetry(fn, tries, log, label) {
  let lastErr;
  for (let t = 1; t <= tries; t++) {
    try { return await fn(t); } catch (e) {
      lastErr = e;
      log(`${label}第 ${t} 次失败：${e.message}`);
      if (t < tries) await new Promise((r) => setTimeout(r, 1500 * t));
    }
  }
  throw lastErr;
}

/* ---------------- 列表页展开 ---------------- */
function pickDetailLinks(data, baseUrl) {
  const host = new URL(baseUrl).host;
  const seen = new Set();
  const scored = [];
  const JOB = /(招聘|招录|选聘|岗位|公告|公开选拔|引进|人才)/;
  for (const l of data.links || []) {
    let u;
    try { u = new URL(l.h, baseUrl); } catch { continue; }
    if (u.host !== host) continue;
    if (u.href === baseUrl) continue;
    if (!/(t20\d{6}|notice|gg|zp|zhaopin|announce|detail|\/\d{6,})/i.test(u.pathname + u.search)) continue;
    if (l.t.length < 6) continue;
    if (seen.has(u.href)) continue;
    seen.add(u.href);
    scored.push({ title: l.t, url: u.href, score: JOB.test(l.t) ? 2 : 1 });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 12);
}

/* ---------------- 一条 URL 全流程 ---------------- */
async function processOne(url, log, opts) {
  const engine = opts.engine === 'local' ? engineLocal : engineLexmount;
  const data = await engine(url, log, opts);

  await parseAttachments(data, log);
  for (const [i, c] of (data.children || []).entries()) await parseAttachments(c, log, `  [${i + 1}] `);
  return data;
}

/* ---------------- 老 .doc → docx（LibreOffice 无头转换） ---------------- */
const SOFFICE = 'C:\\Program Files\\LibreOffice\\program\\soffice.exe';
function convertToDocx(filePath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(SOFFICE)) return reject(new Error('没装 LibreOffice，老 .doc 解析不了'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soff-'));
    const p = spawn(SOFFICE, ['--headless', '--norestore', '--convert-to', 'docx', '--outdir', dir, filePath], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => {
      const out = path.join(dir, path.basename(filePath).replace(/\.[^.]+$/, '') + '.docx');
      if (fs.existsSync(out)) resolve(out);
      else reject(new Error(`LibreOffice 转换失败（code ${code}）：${err.slice(0, 140)}`));
    });
  });
}

/* ---------------- docx 解析（zip + word/document.xml） ---------------- */
function sniff(filePath) {
  const b = Buffer.alloc(8);
  const fd = fs.openSync(filePath, 'r');
  try { fs.readSync(fd, b, 0, 8, 0); } finally { fs.closeSync(fd); }
  return b;
}
function readDocx(filePath) {
  const magic = sniff(filePath);
  if (magic[0] === 0xd0 && magic[1] === 0xcf) {
    throw new Error('这是 OLE2 老 .doc 二进制（扩展名写着 .docx 但内容不是 zip）——本机无 LibreOffice，需另存为真 .docx');
  }
  if (!(magic[0] === 0x50 && magic[1] === 0x4b)) {
    throw new Error('不是 zip（PK）开头，可能下回来的是错误页或被改名的文件：' + magic.toString('hex'));
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-'));
  const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const textOf = (xml) => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => unesc(m[1])).join('');
  return unzipTo(filePath, tmp).then(() => {
    const p = path.join(tmp, 'word', 'document.xml');
    if (!fs.existsSync(p)) throw new Error('docx 里没有 word/document.xml');
    const xml = fs.readFileSync(p, 'utf8');
    const paras = [];
    const tables = [];
    /* 表格：<w:tbl> → <w:tr> → <w:tc>；先摘表，再从正文里挖掉，避免正文混入表内容 */
    const tblRe = /<w:tbl>[\s\S]*?<\/w:tbl>/g;
    const tbls = xml.match(tblRe) || [];
    for (const tb of tbls) {
      const rows = [...tb.matchAll(/<w:tr[^>]*>([\s\S]*?)<\/w:tr>/g)].map((r) =>
        [...r[1].matchAll(/<w:tc[^>]*>([\s\S]*?)<\/w:tc>/g)].map((c) => textOf(c[1]).replace(/\s+/g, ' ').trim())
      ).filter((r) => r.some((c) => c));
      if (rows.length) tables.push(rows);
    }
    const body = xml.replace(tblRe, '');
    for (const pm of body.matchAll(/<w:p[^>]*>([\s\S]*?)<\/w:p>/g)) {
      const t = textOf(pm[1]).trim();
      if (t) paras.push(t);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    return { paras, tables, chars: paras.join('').length + tables.reduce((n, t) => n + t.flat().join('').length, 0) };
  });
}

async function parseAttachments(data, log, tag = '') {
  const files = [...new Map((data.files || []).map((f) => [f.href, f])).values()];
  data.sheets = []; data.pdfs = []; data.docs = [];
  const xls = files.filter((f) => /\.(xlsx?|csv)(\?|$)/i.test(f.href)).slice(0, 2);
  const pdf = files.filter((f) => /\.pdf(\?|$)/i.test(f.href)).slice(0, 2);
  const docx = files.filter((f) => /\.docx(\?|$)/i.test(f.href)).slice(0, 2);
  const docOld = files.filter((f) => /\.doc(\?|$)/i.test(f.href)).slice(0, 2);

  for (const f of xls) {
    try {
      const got = await downloadFile(f.href, log);
      const sheets = await readXlsx(got.path);
      data.sheets.push({ file: got.name, size: got.size, href: f.href, sheets });
      log(`${tag}解析 ${got.name}：${sheets.length} 表 / ${sheets.reduce((n, s) => n + s.rows.length, 0)} 行`);
    } catch (e) { log(`${tag}表格解析失败：` + e.message); }
  }
  for (const f of docx) {
    try {
      const got = await downloadFile(f.href, log);
      const magic = sniff(got.path);
      if (magic[0] === 0xd0 && magic[1] === 0xcf && magic[2] === 0x11 && magic[3] === 0xe0) {
        /* 扩展名写着 .docx，其实是 OLE2 的老 .doc —— 政府站很常见，交给 LibreOffice 转 */
        const conv = await convertToDocx(got.path);
        const r = await readDocx(conv);
        data.docs.push({ file: got.name, size: got.size, href: f.href, kind: 'doc', chars: r.chars, paras: r.paras.slice(0, 200), tables: r.tables.slice(0, 5), via: 'LibreOffice 转换' });
        log(`${tag}解析 ${got.name}（实为老 .doc，LibreOffice 转换后）：${r.chars} 字 / ${r.tables.length} 表 / ${r.paras.length} 段`);
        continue;
      }
      const r = await readDocx(got.path);
      data.docs.push({ file: got.name, size: got.size, href: f.href, kind: 'docx', chars: r.chars, paras: r.paras.slice(0, 200), tables: r.tables.slice(0, 5) });
      log(`${tag}解析 ${got.name}（DOCX）：${r.chars} 字 / ${r.tables.length} 表 / ${r.paras.length} 段`);
    } catch (e) { log(`${tag}DOCX 解析失败：` + e.message); }
  }
  for (const f of docOld) {
    try {
      const got = await downloadFile(f.href, log);
      const conv = await convertToDocx(got.path);
      const r = await readDocx(conv);
      data.docs.push({ file: got.name, size: got.size, href: f.href, kind: 'doc', chars: r.chars, paras: r.paras.slice(0, 200), tables: r.tables.slice(0, 5), via: 'LibreOffice 转换' });
      log(`${tag}解析 ${got.name}（老 .doc → LibreOffice 转换）：${r.chars} 字 / ${r.tables.length} 表 / ${r.paras.length} 段`);
    } catch (e) { log(`${tag}.doc 解析失败：` + e.message); }
  }
  for (const f of pdf) {
    try {
      const got = await downloadFile(f.href, log);
      const r = await readPdf(got.path);
      data.pdfs.push({ file: got.name, size: got.size, href: f.href, lines: r.lines.slice(0, 400), rows: r.body.slice(0, 300), header: r.header, cols: r.cols, chars: r.chars, conf: r.conf, why: r.why, pages: r.pages, scanned: r.scanned });
      log(`${tag}解析 ${got.name}（PDF）：${r.chars} 字，推断 ${r.cols} 列，表头${r.header ? '「' + r.header.filter(Boolean).slice(0, 3).join('|') + '」' : '未识别'}，${r.body.length} 行${r.scanned ? '，⚠ 疑似扫描件需 OCR' : ''}${r.conf === 'low' && !r.scanned ? '，置信度低：' + r.why : ''}`);
    } catch (e) { log(`${tag}PDF 解析失败：` + e.message); }
  }
  if (!xls.length && !pdf.length && !docx.length && !docOld.length) log(`${tag}没有可解析的附件`);
}

/* ---------------- HTTP ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.json': 'application/json; charset=utf-8', '.pdf': 'application/pdf', '.csv': 'text/csv' };
const localStamp = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/selfcheck') {
    // 调试端点：默认关闭，只有显式 LEXMOUNT_SELFCHECK=1 才回应，避免顺手暴露本机路径与 PATH
    if (process.env.LEXMOUNT_SELFCHECK !== '1') { res.writeHead(404); return res.end('not found'); }
    const out = {};
    try {
      const { execFileSync } = require('child_process');
      out.where = String(execFileSync('where', ['pdftotext'])).split(/\r?\n/).filter(Boolean);
    } catch (e) { out.whereErr = e.message; }
    try {
      const name = u.searchParams.get('f') || '13165547ccbt.pdf';
      const f = path.join(DL, path.basename(name));
      const r = await readPdf(f);
      out.pdf = { file: f, exists: fs.existsSync(f), cols: r.cols, header: r.header, rows: r.rows.length,
        bodyLen: r.body.length, body0: r.body[0], bodyLast: r.body[r.body.length - 1],
        pages: r.pages, chars: r.chars, charsPerPage: r.charsPerPage, scanned: r.scanned, conf: r.conf, why: r.why };
    } catch (e) { out.pdfErr = e.message; }
    try {
      const xf = path.join(DL, path.basename(u.searchParams.get('x') || '4848983.xlsx'));
      const sheets = await readXlsx(xf);
      out.xlsx = sheets.map((s) => ({ sheet: s.sheet, header: (s.header || []).slice(0, 10), rows: s.rows.length, row0: (s.rows[0] || []).slice(0, 6) }));
    } catch (e) { out.xlsxErr = e.message; }
    try {
      const f2 = path.join(DL, '30152047p8l8.pdf');
      const r2 = await readPdf(f2);
      out.pdf2 = { cols: r2.cols, header: r2.header, bodyLen: r2.body.length, body0: r2.body[0], bodyLast: r2.body[r2.body.length - 1] };
    } catch (e) { out.pdf2Err = e.message; }
    try {
      const dn = u.searchParams.get('d');
      if (dn) {
        const f3 = path.join(DL, path.basename(dn));
        const r3 = await readDocx(f3);
        out.doc = { file: f3, chars: r3.chars, paras: r3.paras, tables: r3.tables };
      }
    } catch (e) { out.docErr = e.message; }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(out, null, 2));
  }
  if (u.pathname === '/api/runmany' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      const logs = [];
      const log = (m) => { logs.push({ t: localStamp(new Date()).slice(11, 19), m }); };
      try {
        const { urls = [], engine = 'lexmount', expand = false, concurrency = 3, maxChildren = 5 } = JSON.parse(body || '{}');
        const list = urls.map((s) => String(s).trim()).filter((s) => /^https?:\/\//i.test(s));
        if (!list.length) throw new Error('urls 里没有合法地址');
        const all = [], fails = [];
        for (let i = 0; i < list.length; i++) {
          log(`[${i + 1}/${list.length}] ${list[i]}`);
          try {
            const data = await processOne(list[i], log, { engine, expand, concurrency: Number(concurrency) || 3, maxChildren: Number(maxChildren) || 5 });
            all.push(data);
            fs.writeFileSync(path.join(RUNS, 'run-' + Date.now() + '.json'), JSON.stringify({ url: list[i], engine, logs: [], data, savedAt: new Date().toISOString() }, null, 2));
            log(`  完成：${data.charCount || 0} 字 / ${(data.files || []).length} 附件 / ${(data.children || []).length} 子页`);
          } catch (e) {
            fails.push({ url: list[i], error: e.message });
            log(`  失败：${e.message}`);
          }
        }
        const batch = { kind: 'batch', urls: list, engine, savedAt: new Date().toISOString(), data: all, fails };
        const file = 'batch-' + Date.now() + '.json';
        fs.writeFileSync(path.join(RUNS, file), JSON.stringify(batch, null, 2));
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: true, file, logs, count: all.length, fails }, null, 2));
      } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: e.message, logs }, null, 2));
      }
    });
    return;
  }
  if (u.pathname === '/api/run' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      const logs = [];
      const log = (m) => { logs.push({ t: localStamp(new Date()).slice(11, 19), m }); };
      try {
        const { url, engine = 'lexmount', expand = false, concurrency = 3, maxChildren = 5 } = JSON.parse(body || '{}');
        if (!/^https?:\/\//i.test(url || '')) throw new Error('URL 需要以 http(s):// 开头');
        log(`引擎：${engine === 'local' ? '本机 Chrome (CDP)' : 'Lexmount 云浏览器'}`);
        const data = await processOne(url, log, { engine, expand, concurrency: Number(concurrency) || 3, maxChildren: Number(maxChildren) || 5 });
        const rec = { url, engine, logs, data, savedAt: new Date().toISOString() };
        fs.writeFileSync(path.join(RUNS, 'run-' + Date.now() + '.json'), JSON.stringify(rec, null, 2));
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, logs, data }));
      } catch (e) {
        log('失败：' + e.message);
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, logs, error: e.message }));
      }
    });
    return;
  }

  if (u.pathname === '/api/runs') {    const files = fs.existsSync(RUNS) ? fs.readdirSync(RUNS).filter((f) => f.endsWith('.json')) : [];
    const items = files.map((f) => {
      const p = path.join(RUNS, f);
      const st = fs.statSync(p);
      let meta = {};
      try {
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (Array.isArray(j.data)) {
          // 批次记录：聚合每条单跑的元信息，避免历史页出现空行
          const arr = j.data;
          meta = {
            url: (j.urls || [])[0],
            title: `批次 · ${arr.length} 条${j.fails && j.fails.length ? `（${j.fails.length} 失败）` : ''}`,
            files: arr.reduce((n, d) => n + ((d.files || []).length), 0),
            rows: arr.reduce((n, d) => n
              + (d.sheets || []).reduce((m, s) => m + s.sheets.reduce((k, x) => k + x.rows.length, 0), 0)
              + (d.pdfs || []).reduce((m, p2) => m + p2.rows.length, 0)
              + (d.children || []).reduce((m, c) => m + (c.pdfs || []).reduce((k, p3) => k + p3.rows.length, 0), 0), 0),
            ms: arr.reduce((n, d) => n + (d.ms || 0), 0),
            engine: j.engine,
          };
        } else {
          const d = j.data || {};
          meta = {
            url: d.url, title: (d.title || d.h1 || '').slice(0, 60),
            files: (d.files || []).length,
            rows: (d.sheets || []).reduce((n, s) => n + s.sheets.reduce((m, x) => m + x.rows.length, 0), 0)
              + (d.pdfs || []).reduce((n, p2) => n + p2.rows.length, 0)
              + ((d.children || []).reduce((n, c) => n + ((c.pdfs || []).reduce((m, p3) => m + p3.rows.length, 0)), 0)),
            ms: d.ms, engine: d.engine,
          };
        }
      } catch (e) { meta.err = e.message; }
      return { file: f, at: localStamp(st.mtime), size: st.size, ...meta };
    }).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 40);
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, items }));
  }
  if (u.pathname === '/api/runfile') {
    const f = path.basename(u.searchParams.get('f') || '');
    const p = path.join(RUNS, f);
    if (!f.endsWith('.json') || !fs.existsSync(p)) { res.writeHead(404); return res.end('no'); }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(fs.readFileSync(p));
  }

  // 静态文件：先解码，再解析成绝对路径，最后确认仍落在 ROOT 内——挡掉 ../ 穿越和同前缀兄弟目录
  let relPath;
  try { relPath = decodeURIComponent(u.pathname); } catch (e) { res.writeHead(400); return res.end('bad path'); }
  if (relPath.indexOf('\0') >= 0) { res.writeHead(400); return res.end('bad path'); }
  const rootAbs = path.resolve(ROOT);
  const fp = path.resolve(relPath === '/' ? path.join(rootAbs, 'public', 'index.html') : path.join(rootAbs, relPath));
  const cmpFp = fp.toLowerCase(), cmpRoot = rootAbs.toLowerCase();
  if (cmpFp !== cmpRoot && !cmpFp.startsWith(cmpRoot + path.sep)) { res.writeHead(403); return res.end('no'); }
  fs.readFile(fp, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(buf);
  });
});

server.on('error', (e) => {
  console.error('启动失败：' + e.message + (e.code === 'EADDRINUSE' ? '（端口 ' + PORT + ' 已被占用，先关掉旧进程）' : ''));
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => console.log('采集台已启动 → http://127.0.0.1:' + PORT + '/'));
