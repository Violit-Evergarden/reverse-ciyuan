#!/usr/bin/env python3
"""解析抓包得到的 HTTP/2 明文帧文件(Conscrypt 明文流 dump 的产物).

- 请求方向文件含 `PRI * HTTP/2.0` preface, 可按 preface 切分多条连接;
- 响应方向无 preface, 若为多连接拼接需配合按连接身份分组的文件(见 raw_* 目录);
- 每个连接使用独立 HPACK 解码器; 按 stream 聚合 DATA 得到 body;
- 依据 content-type 自动落盘: protobuf -> .pb, webp/image -> .webp, 其余 -> .bin.

用法:
    python3 parse_http2.py <frames.bin> [outdir]
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


def parse_file(path: str, outdir: str):
    d = open(path, 'rb').read()
    for ci, seg in enumerate(split_connections(d)):
        dec = hpack.Decoder()
        hdrs, data = {}, {}
        for typ, flags, sid, pay in frames(seg):
            if typ == 1:
                try:
                    for k, v in dec.decode(pay):
                        k = k.decode() if isinstance(k, bytes) else k
                        v = v.decode() if isinstance(v, bytes) else v
                        hdrs.setdefault(sid, {})[k] = v
                except Exception:
                    pass
            elif typ == 0 and pay:
                data[sid] = data.get(sid, b'') + pay
        base = os.path.basename(path)
        print('##### %s conn%d' % (base, ci))
        for sid in sorted(hdrs):
            h, body = hdrs[sid], data.get(sid, b'')
            keys = (':method', ':path', ':status', 'content-type', 'content-length', 'x-protobuf-message')
            print('  stream%d %s data=%d' % (sid, {k: h.get(k) for k in keys if h.get(k)}, len(body)))
            if not body or not outdir:
                continue
            ct = h.get('content-type', '')
            if 'protobuf' in ct:
                ext = '.pb'
            elif 'webp' in ct or 'image' in ct:
                ext = '.webp'
            elif 'json' in ct:
                ext = '.json'
            else:
                ext = '.bin'
            fn = os.path.join(outdir, '%s_c%d_s%d%s' % (os.path.splitext(base)[0], ci, sid, ext))
            open(fn, 'wb').write(body)
            print('     -> %s' % fn)


if __name__ == '__main__':
    path = sys.argv[1]
    outdir = sys.argv[2] if len(sys.argv) > 2 else None
    if outdir:
        os.makedirs(outdir, exist_ok=True)
    parse_file(path, outdir)
