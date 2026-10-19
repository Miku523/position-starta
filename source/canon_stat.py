# -*- coding: utf-8 -*-
"""重算口径：把一批里的多个来源按 11 个统一字段归一，再出统计。
用法：python canon_stat.py runs/batch-1792437271749.json
"""
import json
import re
import sys
from collections import Counter

sys.stdout.reconfigure(encoding='utf-8')

def norm(s):
    return re.sub(r'[（）()\s　]', '', str(s or ''))

# 统一字段 -> 同义词与排除规则（与前端 CANON 一致）
CANON = [
    ('地区', ['考区', '地区', '工作地点', '所在地', '招聘地区', '工作区域'], None),
    ('单位', ['招聘单位', '单位名称', '用人单位', '招录机关', '单位'], r'代码|编码|编号'),
    ('岗位', ['岗位名称', '招聘岗位', '职位名称', '岗位', '职位'], r'职责|任务|描述|要求|等级|类别|代码|编码'),
    ('岗位代码', ['岗位代码', '职位代码', '岗位编码', '岗位编号', '职位编码'], None),
    ('学历', ['学历要求', '最低学历', '学历'], None),
    ('学位', ['学位要求', '学位'], None),
    ('专业', ['专业要求', '专业'], r'代码'),
    ('人数', ['聘用人数', '招聘人数', '招录人数', '计划人数', '人数', '计划数'], None),
    ('部门', ['工作部门', '部门', '内设机构'], r'代码|编码'),
    ('职责', ['岗位职责任务', '岗位职责', '职位描述', '工作内容'], None),
    ('等级', ['岗位等级', '岗位类别', '职级'], None),
]
MULTI = {'专业'}

def pick(header, syns, not_re):
    out = []
    want_code = any(re.search(r'代码|编码|编号', s) for s in syns)
    def ok(h):
        if not_re and re.search(not_re, str(h or '')):
            return False
        return True
    def is_code(h):
        return bool(re.search(r'代码|编码|编号', str(h or '')))
    for syn in syns:
        for i, h in enumerate(header):
            if norm(h) == norm(syn) and ok(h) and (want_code or not is_code(h)):
                if i not in out:
                    out.append(i)
        if out and syns == [syns[0], syns[0]]:
            pass
        if out and len(out) and syns and syns[0] == syn:
            if not any(True for _ in out):
                pass
        if out:
            break
    if out:
        return out
    for syn in syns:
        for i, h in enumerate(header):
            if norm(h).startswith(norm(syn)) and ok(h) and (want_code or not is_code(h)):
                if i not in out:
                    out.append(i)
        if out:
            break
    if out:
        return out
    for syn in syns:
        n = norm(syn)
        if len(n) < 2:
            continue
        for i, h in enumerate(header):
            if n in norm(h) and ok(h) and (want_code or not is_code(h)):
                if i not in out:
                    out.append(i)
        if out:
            break
    return out


def canon_map(header):
    m, hit = {}, 0
    for key, syns, not_re in CANON:
        idx = pick(header, syns, not_re)
        if idx:
            m[key] = idx if key in MULTI else idx[:1]
            hit += 1
    return (m, hit) if hit >= 3 else (None, hit)


def cell(row, idx):
    return str(row[idx]).strip() if idx is not None and idx < len(row) and row[idx] is not None else ''


def collect(tables):
    """tables: [(source, header, rows)] -> 归一后的行（dict）"""
    out = []
    skipped = []
    for source, header, rows in tables:
        m, hit = canon_map(header)
        if not m:
            skipped.append((source, len(rows)))
            continue
        for r in rows:
            rec = {}
            for key, idxs in m.items():
                if key == '专业':
                    vals = [cell(r, i) for i in idxs]
                    vals = [v for v in vals if v]
                    rec[key] = ' / '.join(vals)
                else:
                    rec[key] = cell(r, idxs[0])
            if not any(rec.values()):
                continue
            rec['_src'] = source
            # 广东那条专有的「考生类别」，直接按表头抓
            for i, h in enumerate(header):
                if norm(h) == '考生类别':
                    rec['考生类别'] = cell(r, i)
                    break
            out.append(rec)
    return out, skipped


def norm_edu(s):
    s = str(s or '')
    if not s:
        return ''
    if '博士' in s:
        return '博士'
    if '硕士' in s or '研究生' in s:
        return '硕士及以上'
    if '本科' in s or '学士' in s:
        return '本科'
    if '大专' in s or '专科' in s or '高职' in s:
        return '大专'
    if '中专' in s or '中技' in s or '技工' in s:
        return '中专/技校'
    if '高中' in s:
        return '高中'
    return '其他'


def split_majors(s):
    parts = re.split(r'[，,;；/、]+', str(s or ''))
    out = []
    for p in parts:
        p = re.sub(r'[（(][^）)]*[）)]', '', p).strip()
        if 1 < len(p) <= 18:
            out.append(p)
    return out


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else 'runs/batch-1792437271749.json'
    d = json.load(open(path, encoding='utf-8'))
    tables = []
    for x in d.get('data', []):
        src = (x.get('title') or x.get('url') or '')[:40]
        for s in (x.get('sheets') or []):
            for y in (s.get('sheets') or []):
                tables.append((src, y.get('header') or [], y.get('rows') or []))
        for p in (x.get('pdfs') or []):
            tables.append((src, p.get('header') or [], p.get('rows') or []))
        if (x.get('tables') or []) and isinstance(x['tables'][0], dict):
            for t in x['tables']:
                tables.append((src, t.get('header') or [], t.get('rows') or []))

    recs, skipped = collect(tables)
    n = len(recs)
    stat = {'总行数': n, '来源': sorted({r['_src'] for r in recs}), '跳过': skipped}

    edu = Counter(norm_edu(r.get('学历')) for r in recs)
    edu.pop('', None)
    stat['学历'] = {k: [v, round(v / n * 100, 1)] for k, v in edu.most_common()}

    majors = Counter()
    for r in recs:
        for m in set(split_majors(r.get('专业'))):
            majors[m] += 1
    stat['专业Top12'] = majors.most_common(12)
    stat['专业空行'] = sum(1 for r in recs if not r.get('专业'))

    stat['地区'] = Counter(r.get('地区') or '(空)' for r in recs).most_common(8)
    stat['单位数'] = len({r.get('单位') for r in recs if r.get('单位')})
    stat['人数合计'] = sum(int(r['人数']) for r in recs if str(r.get('人数', '')).isdigit())
    stat['岗位名空行'] = sum(1 for r in recs if not r.get('岗位'))
    stat['应届'] = Counter(r.get('考生类别') or '(空)' for r in recs).most_common(6)
    ying = sum(1 for r in recs if '应届' in str(r.get('考生类别') or ''))
    stat['只招应届'] = [ying, round(ying / n * 100, 1)]
    stat['来源构成'] = Counter(r['_src'] for r in recs).most_common()
    print(json.dumps(stat, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
