#!/usr/bin/env python3
"""极简 protobuf wire-format 递归解析/打印工具(无需 .proto).

用于快速查看抓包得到的 .pb  body 结构: 字段号 / wire type / 值;
bytes 字段若为可打印字符串则按字符串显示, 否则尝试递归为嵌套 message.

用法:
    python3 parse_proto.py <file.pb> [max_depth]
    python3 parse_proto.py <file.pb> [max_depth] --path 3,2,1   # 沿字段路径下钻(如 resp f3.f2.f1)
"""
import sys


def read_varint(b, i):
    r = s = 0
    while True:
        x = b[i]
        i += 1
        r |= (x & 0x7f) << s
        if not x & 0x80:
            return r, i
        s += 7


def parse(b, i=0, end=None, depth=0, maxd=4):
    end = len(b) if end is None else end
    out = []
    while i < end:
        try:
            key, i = read_varint(b, i)
        except Exception:
            break
        fn, wt = key >> 3, key & 7
        if wt == 0:
            v, i = read_varint(b, i)
            out.append((fn, 'varint', v))
        elif wt == 1:
            out.append((fn, 'fixed64', int.from_bytes(b[i:i + 8], 'little')))
            i += 8
        elif wt == 5:
            out.append((fn, 'fixed32', int.from_bytes(b[i:i + 4], 'little')))
            i += 4
        elif wt == 2:
            ln, i = read_varint(b, i)
            pay = b[i:i + ln]
            i += ln
            nested = None
            if depth < maxd:
                try:
                    n = parse(pay, 0, len(pay), depth + 1, maxd)
                    if n:
                        nested = n
                except Exception:
                    nested = None
            out.append((fn, 'bytes', pay, nested))
        else:
            break
    return out


def is_text(pay):
    try:
        s = pay.decode('utf-8')
        return all(32 <= ord(c) < 127 or ord(c) > 0x2000 for c in s), s
    except Exception:
        return False, None


def show(items, ind=0):
    for it in items:
        fn, wt = it[0], it[1]
        if wt == 'bytes':
            pay = it[2]
            nest = it[3] if len(it) > 3 else None
            ok, s = is_text(pay)
            if ok and s:
                print('  ' * ind + 'f%d str = %r' % (fn, s[:90]))
            elif nest:
                print('  ' * ind + 'f%d msg{' % fn)
                show(nest, ind + 1)
                print('  ' * ind + '}')
            else:
                print('  ' * ind + 'f%d bytes[%d] = %s' % (fn, len(pay), pay[:24].hex()))
        else:
            print('  ' * ind + 'f%d %s = %s' % (fn, wt, it[2]))


def drill(items, path):
    cur = items
    for fn in path:
        nxt = None
        for it in cur:
            if it[0] == fn and it[1] == 'bytes' and len(it) > 3 and it[3]:
                nxt = it[3]
                break
        if nxt is None:
            print('path stop at f%d' % fn)
            return cur
        cur = nxt
    return cur


if __name__ == '__main__':
    path = sys.argv[1]
    maxd = 4
    args = sys.argv[2:]
    drill_path = []
    if '--path' in args:
        k = args.index('--path')
        drill_path = [int(x) for x in args[k + 1].split(',') if x]
        args = args[:k] + args[k + 2:]
    if args:
        maxd = int(args[0])
    b = open(path, 'rb').read()
    items = parse(b, 0, len(b), 0, maxd)
    if drill_path:
        items = drill(items, drill_path)
    show(items)
