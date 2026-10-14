#!/usr/bin/env python3
"""次元壁纸 策展账号扫描 — 2026-10-14 新增.

翻页首页流(游标分页), 按 uploader(APP 账号 ID)聚合转载作品, 生成带 pixiv 链接的
markdown 报告。背景见 docs/ciyuan_reverse_engineering_report.md §10:
作者(author=pixiv 画师) ≠ uploader(APP 账号), 少数策展账号批量导入。

用法:
  python tools/curator_scan.py --pages 20 --out data/curator_scan_20261014.md
"""
import argparse
import collections
import datetime
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ciyuan_channel_client as c


def pixiv_link(pid):
    s = str(pid or '')
    if '-' in s:
        base, _, page = s.partition('-')
        if base.isdigit():
            return f'[{"-".join(s.split("-"))}](https://www.pixiv.net/artworks/{base}) (第{int(page) or 1}页)'
    if s.isdigit():
        return f'[{s}](https://www.pixiv.net/artworks/{s})'
    if len(s) == 32:
        return '站外源(32hex, 无 pixiv 链接)'
    return '—'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pages', type=int, default=20)
    ap.add_argument('--out', default=None)
    a = ap.parse_args()

    token = c.S.get('token') or c.login()
    cursor, rows, seen = c.INT64_MAX, [], set()
    for p in range(a.pages):
        inner = c.t_v(1, cursor) + c.t_v(3, 0)
        ws = c.parse_wallpapers(c.channel('LoadWallpaperReq', inner, token))
        if not ws:
            break
        for w in ws:
            if w['id'] not in seen:
                seen.add(w['id'])
                rows.append(w)
        cursor = ws[-1]['createdAt']
        print(f'page {p + 1}: +{len(ws)} 累计 {len(rows)}', file=sys.stderr)

    by = collections.defaultdict(list)
    for w in rows:
        by[w.get('uploader') or '(无 uploader)'].append(w)

    day = datetime.date.today().strftime('%Y%m%d')
    out = a.out or os.path.join(c.ROOT, 'data', f'curator_scan_{day}.md')
    L = [f'# 策展账号转载扫描 ({day})',
         f'',
         f'扫描首页流前 {a.pages} 页, 去重后 **{len(rows)}** 条; 不同 uploader **{len(by)}** 个。',
         f'uploader 为 APP 账号 ID(协议无按 ID 查昵称的消息, Data/UserManage 未实测);',
         f'author 为 pixiv 画师。pixiv 链接中 `-N` 为多图投稿第 N 页。',
         f'']
    for up, ws in sorted(by.items(), key=lambda kv: -len(kv[1])):
        pix = sum(1 for w in ws if str(w.get('pixivId') or '').split('-')[0].isdigit())
        span = f"{datetime.date.fromtimestamp(min(w['createdAt'] for w in ws) / 1000)} ~ {datetime.date.fromtimestamp(max(w['createdAt'] for w in ws) / 1000)}"
        L += [f'## `{up}` — {len(ws)} 条 (pixiv 源 {pix}, 非 pixiv {len(ws) - pix})',
              f'上传时间跨度: {span}',
              f'',
              '| 作者(pixiv 画师) | 作品 | 日期 | 来源 |',
              '|---|---|---|---|']
        for w in sorted(ws, key=lambda w: -w['createdAt']):
            d = datetime.date.fromtimestamp(w['createdAt'] / 1000)
            L.append(f"| {w.get('author') or '—'} | {w.get('comic') or '—'} | {d} | {pixiv_link(w.get('pixivId'))} |")
        L.append('')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, 'w', encoding='utf-8').write('\n'.join(L))
    print(f'written: {out}', file=sys.stderr)
    for up, ws in sorted(by.items(), key=lambda kv: -len(kv[1])):
        pix = sum(1 for w in ws if str(w.get('pixivId') or '').split('-')[0].isdigit())
        print(f'{up}  n={len(ws):4d}  pixiv={pix:4d}')


if __name__ == '__main__':
    main()
