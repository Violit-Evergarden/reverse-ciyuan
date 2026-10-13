#!/usr/bin/env python3
"""打印 HTTP/2 明文帧文件中每个 stream 的完整请求/响应头 + body 十六进制预览.

与 parse_http2.py 同源(按 PRI preface 切连接, 每连接独立 HPACK), 但输出全部 header,
用于复现 App 的精确请求头(UA/版本标识等). 新增于 2026-10-14 (web 版数据源建设).

用法:
    python tools/dump_headers.py <frames.bin> [--body-stream N] [--max-body BYTES]
依赖: pip install hpack
"""
import sys, os, hpack

TYPES = {0: 'DATA', 1: 'HEADERS', 2: 'PRIORITY', 3: 'RST_STREAM', 4: 'SETTINGS',
         5: 'PUSH_PROMISE', 6: 'PING', 7: 'GOAWAY', 8: 'WINDOW_UPDATE', 9: 'CONTINUATION'}


def split_connections(d: bytes):
    idx = [m for m in range(len(d)) if d.startswith(b'PRI * HTTP/2.0', m)]
    if not idx:
        return [d]
    return [d[idx[i]: (idx[i + 1] if i + 1 < len(idx) else len(d))] for i in range(len(idx))]


def frames(d: bytes):
    i = d.index(b'SM\r\n\r\n') + 6 if d.startswith(b'PRI * HTTP/2.0') else 0
    while i + 9 <= len(d):
        ln = int.from_bytes(d[i:i + 3], 'big')
        typ, flags = d[i + 3], d[i + 4]
        sid = int.from_bytes(d[i + 5:i + 9], 'big') & 0x7fffffff
        yield typ, flags, sid, d[i + 9:i + 9 + ln]
        i += 9 + ln


def main():
    path = sys.argv[1]
    body_stream = None
    max_body = 512
    if '--body-stream' in sys.argv:
        body_stream = int(sys.argv[sys.argv.index('--body-stream') + 1])
    if '--max-body' in sys.argv:
        max_body = int(sys.argv[sys.argv.index('--max-body') + 1])
    d = open(path, 'rb').read()
    print('file: %s (%d bytes)' % (path, len(d)))
    for ci, seg in enumerate(split_connections(d)):
        dec = hpack.Decoder()
        hdrs, data = {}, {}
        order = []
        for typ, flags, sid, pay in frames(seg):
            if typ == 1:
                try:
                    h = {}
                    for k, v in dec.decode(pay):
                        k = k.decode() if isinstance(k, bytes) else k
                        v = v.decode() if isinstance(v, bytes) else v
                        h[k] = v
                    hdrs[sid] = h
                    order.append(sid)
                except Exception as e:
                    print('  [hpack decode error stream%d: %s]' % (sid, e))
            elif typ == 0 and pay:
                data[sid] = data.get(sid, b'') + pay
        print('=== conn%d (%d bytes, %d streams with headers) ===' % (ci, len(seg), len(order)))
        for sid in order:
            h = hdrs[sid]
            pseudo = {k: v for k, v in h.items() if k.startswith(':')}
            regular = {k: v for k, v in h.items() if not k.startswith(':')}
            print(' stream %d  %s %s  %s' % (sid, pseudo.get(':method', pseudo.get(':status', '?')),
                                             pseudo.get(':path', ''), pseudo.get(':status', '')))
            for k, v in regular.items():
                print('    %s: %s' % (k, v))
            body = data.get(sid, b'')
            print('    body: %d bytes' % len(body))
            if body and (body_stream is None or body_stream == sid):
                show = body[:max_body]
                try:
                    txt = show.decode('utf-8')
                    printable = all(c.isprintable() or c in '\r\n\t' for c in txt)
                except UnicodeDecodeError:
                    printable = False
                if printable:
                    print('    body-text: %r%s' % (txt, ' ...' if len(body) > max_body else ''))
                else:
                    print('    body-hex: %s%s' % (show.hex(), ' ...' if len(body) > max_body else ''))


if __name__ == '__main__':
    main()
