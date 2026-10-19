# -*- coding: utf-8 -*-
"""从批次 JSON 导出归一后的岗位表 CSV，供提交包使用。
用法：python dump_canon.py ../recruit-tool/runs/batch-1792437271749.json out.csv
"""
import csv
import json
import sys

sys.path.insert(0, '../recruit-tool')
from canon_stat import collect  # noqa: E402

FIELDS = ['来源公告', '地区', '单位', '岗位', '岗位代码', '学历', '学位',
          '专业', '人数', '部门', '职责', '等级', '考生类别']


def tables_of(path):
    b = json.load(open(path, encoding='utf-8'))
    entries = b.get('data') if isinstance(b.get('data'), list) else [b.get('data')]
    tabs = []

    def add(src, t):
        for sub in (t.get('sheets') or []):
            if sub.get('rows'):
                tabs.append((src + ' · ' + str(sub.get('sheet') or ''), sub.get('header') or [], sub['rows']))
        for sub in (t.get('tables') or []):
            if isinstance(sub, dict) and sub.get('rows'):
                tabs.append((src, sub.get('header') or [], sub['rows']))
        if t.get('rows') and not t.get('sheets') and not t.get('tables'):
            tabs.append((src, t.get('header') or [], t['rows']))

    for e in entries:
        if not e:
            continue
        src = e.get('title') or e.get('h1') or e.get('url') or '未命名'
        for key in ('sheets', 'pdfs', 'docs'):
            for t in (e.get(key) or []):
                add(src, t)
        for c in (e.get('children') or []):
            csrc = c.get('title') or c.get('url') or src
            for key in ('sheets', 'pdfs', 'docs'):
                for t in (c.get(key) or []):
                    add(csrc, t)
    return tabs


def main():
    src, out = sys.argv[1], sys.argv[2]
    tabs = tables_of(src)
    recs, skipped = collect(tabs)
    with open(out, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(FIELDS)
        for r in recs:
            w.writerow([r.get('_src' if k == '来源公告' else k, '') for k in FIELDS])
    print('tables=%d rows=%d skipped=%d -> %s' % (len(tabs), len(recs), len(skipped), out))


if __name__ == '__main__':
    main()
