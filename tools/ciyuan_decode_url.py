#!/usr/bin/env python3
"""次元壁纸 url(原图)解码器.

背景: rank 接口返回的 wallpaper.url 指向 bitiful.cdn.13th.tech 的 *.a 文件,
它是「整文件单字节 XOR 混淆过的 webp」, 且 CDN 有 WAF: 必须带浏览器 User-Agent,
否则 403. content-type 为 application/x-archive, 浏览器无法直接渲染.

用法:
    python3 ciyuan_decode_url.py <url> [out.webp]
    python3 ciyuan_decode_url.py --all /tmp/ciyuan_rank.json outdir/
"""
import sys, struct, urllib.request, json, os

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/121.0 Safari/537.36')


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def decode(data: bytes) -> bytes:
    """单字节 XOR 解码. key 由首字节推导: 假设明文为 RIFF webp, key = raw[0] ^ 'R'."""
    if data[:4] == b'RIFF':
        return data  # 未混淆
    key = data[0] ^ 0x52
    x = bytes(b ^ key for b in data)
    if x[:4] != b'RIFF' or x[8:12] != b'WEBP':
        raise ValueError('decode failed: not a RIFF/WEBP after xor %#x' % key)
    riff = struct.unpack('<I', x[4:8])[0]
    if riff != len(x) - 8:
        raise ValueError('riff size mismatch: %d vs %d' % (riff, len(x) - 8))
    return x


def main():
    if len(sys.argv) > 1 and sys.argv[1] == '--all':
        j = json.load(open(sys.argv[2]))
        outdir = sys.argv[3] if len(sys.argv) > 3 else '.'
        os.makedirs(outdir, exist_ok=True)
        ws = [w for it in j['data']['items'] for w in it['wallpapers']]
        for i, w in enumerate(ws):
            try:
                x = decode(fetch(w['url']))
                p = os.path.join(outdir, '%s.webp' % w['md5'])
                open(p, 'wb').write(x)
                print('ok  ', p, len(x))
            except Exception as e:
                print('fail', w['url'], e)
        return
    url = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else 'out.webp'
    x = decode(fetch(url))
    open(out, 'wb').write(x)
    print('saved', out, len(x), 'bytes')


if __name__ == '__main__':
    main()
