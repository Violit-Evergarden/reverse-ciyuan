#!/usr/bin/env python3
"""次元壁纸 协议级客户端 (无需 App/模拟器, 直接复现 API) — 2026-10-14 新增.

复现内容 (完整推导见 docs/ciyuan_reverse_engineering_report.md §8/§9):
  * 签名:  sign(input) = md5hex( md5hex( SALT + input ) )     [双重 MD5, libhell.so native_sign]
      - HTTP JSON API (/rank, /u/login): input = 排序去重的 "k=v" 用 & 连接 (query/form 参数 + t=<ms>)
      - /channel:  input = hex( Channel 信封去掉 sg(f8) 字段后的规范化序列化 )
  * /channel Channel 信封字段: req=1(Any) token=2 p=3 v=4 vn=5 ua=6 t=7 sg=8 cd=9 sh=10 nd=11 mt=12 ij=13
  * LoadWallpaperReq{ endTime=1(游标,INT64_MAX=最新), comic=2, landscape=3, pixivId=4 } → Rsp{wallpapers=1}
  * Wallpaper{ id=1 author=2 isR16=3 pixivId=4 tags=5 thumbUrl=6 url=7 width=8 height=9
               comic=10 characters=11 uploader=12 createdAt=13 }
  * 原图 *.a = 整文件单字节 XOR webp, key = raw[0]^0x52 (见 ciyuan_decode_url.py)

敏感常量 (SALT/账号) 不入库: 从 web/secrets.local.json 或环境变量 CIYUAN_SALT/CIYUAN_ACC/CIYUAN_PWD 读取.

用法:
  python tools/ciyuan_channel_client.py verify            # 用抓包样本离线验证签名算法 (5/5)
  python tools/ciyuan_channel_client.py rank              # 拉排行 JSON
  python tools/ciyuan_channel_client.py feed [--cursor N] [--comic 名称] [--pages 2]
  python tools/ciyuan_channel_client.py login             # 登录并打印用户信息(token 不回显全量)
"""
import argparse, hashlib, json, os, sys, time, urllib.request, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SECRETS = os.path.join(ROOT, 'web', 'secrets.local.json')
BASE = 'https://api.awsl.13th.tech'
UA_JSON = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
           '(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0')
TYPE_URL = 'type.googleapis.com/me.alzz.awsl.proto.'
INT64_MAX = (1 << 63) - 1
APP = dict(v=102, vn='2.11.5', sh=1632386598)
CD_B64 = 'L2RhdGEvZGF0YS9tZS5hbHp6LmF3c2wvY2FjaGU='
ND_B64 = 'L2RhdGEvYXBwL35+a0NrZ2NpV0NwS0N2RmRiMDNmcFE3UT09L21lLmFsenouYXdzbC0yX2VUTlR0NGJSNHVoXzFZUV'


def secrets():
    d = {}
    if os.path.exists(SECRETS):
        d = json.load(open(SECRETS, encoding='utf-8'))
    for k, env in (('salt', 'CIYUAN_SALT'), ('account', 'CIYUAN_ACC'), ('pwd', 'CIYUAN_PWD'), ('token', 'CIYUAN_TOKEN')):
        if os.environ.get(env):
            d[k] = os.environ[env]
    return d


S = secrets()
SALT = (S.get('salt') or '').encode()


def md5hex(b): return hashlib.md5(b).hexdigest()


def sign(inp):
    if isinstance(inp, str): inp = inp.encode()
    return md5hex(md5hex(SALT and (SALT + inp) or inp).encode()) if SALT else md5hex(md5hex(inp).encode())


# ---------- protobuf wire ----------
def wv(n):
    out = bytearray()
    if n < 0: n += 1 << 64
    while True:
        b = n & 0x7f; n >>= 7
        out.append(b | (0x80 if n else 0))
        if not n: return bytes(out)


def t_v(fn, v): return wv((fn << 3) | 0) + wv(v)


def t_b(fn, b):
    if isinstance(b, str): b = b.encode()
    return wv((fn << 3) | 2) + wv(len(b)) + b


def parse(b):
    i, out = 0, []
    def rv():
        nonlocal i
        r = s = 0
        while True:
            x = b[i]; i += 1
            r |= (x & 0x7f) << s; s += 7
            if not x & 0x80: return r
    while i < len(b):
        key = rv(); fn, wt = key >> 3, key & 7
        if wt == 0: out.append((fn, 0, rv()))
        elif wt == 2:
            ln = rv(); out.append((fn, 2, b[i:i+ln])); i += ln
        elif wt == 5: out.append((fn, 5, b[i:i+4])); i += 4
        elif wt == 1: out.append((fn, 1, b[i:i+8])); i += 8
        else: raise ValueError('wt %d' % wt)
    return out


def s_(v): return v.decode('utf-8', 'replace') if isinstance(v, bytes) else v


def parse_wallpapers(val):
    ws = []
    for fn, wt, v in parse(val):
        if fn != 1 or wt != 2: continue
        w = {'tags': [], 'characters': []}
        for f2, w2, v2 in parse(v):
            k = {1:'id',2:'author',6:'thumbUrl',7:'url',10:'comic',12:'uploader'}.get(f2)
            if k: w[k] = s_(v2)
            elif f2 == 3: w['isR16'] = bool(v2)
            elif f2 == 4: w['pixivId'] = s_(v2) if w2 == 2 else v2  # string 字段(pixiv 数字 ID 或 32hex 外部 ID)
            elif f2 == 5: w['tags'].append(s_(v2))
            elif f2 == 8: w['width'] = v2
            elif f2 == 9: w['height'] = v2
            elif f2 == 11: w['characters'].append(s_(v2))
            elif f2 == 13: w['createdAt'] = v2
        ws.append(w)
    return ws


def build_channel(inner, type_name, token):
    any_msg = t_b(1, TYPE_URL + type_name) + t_b(2, inner)
    p1 = t_b(1, any_msg) + (t_b(2, token) if token else b'') + t_v(4, APP['v']) + t_b(5, APP['vn']) + t_b(6, UA_JSON) + t_v(7, int(time.time()*1000))
    p2 = t_b(9, CD_B64) + t_v(10, APP['sh']) + t_b(11, ND_B64)
    pre = p1 + p2
    return p1 + t_b(8, sign(pre.hex())) + p2


def http(url, data=None, headers=None):
    req = urllib.request.Request(url, data=data, headers=headers or {})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def api_get_json(path, pairs):
    t = str(int(time.time()*1000))
    vals = sorted({f'{k}={v}' for k, v in pairs if str(v).strip()} | {f't={t}'})
    return json.loads(http(BASE + path + ('?' + urllib.parse.urlencode(pairs) if pairs else ''),
                           headers={'user-agent': UA_JSON, 't': t, 'sign': sign('&'.join(vals)),
                                    'accept': 'application/json,text/json'}).decode())


def api_post_form(path, form):
    t = str(int(time.time()*1000))
    vals = sorted({f'{k}={v}' for k, v in form.items() if str(v).strip()} | {f't={t}'})
    body = urllib.parse.urlencode(form).encode()
    return json.loads(http(BASE + path, data=body, headers={
        'user-agent': UA_JSON, 't': t, 'sign': sign('&'.join(vals)),
        'content-type': 'application/x-www-form-urlencoded',
        'accept': 'application/json,text/json'}).decode())


def channel(type_name, inner, token):
    raw = http(BASE + '/channel', data=build_channel(inner, type_name, token), headers={
        'content-type': 'application/x-protobuf', 'user-agent': 'okhttp/4.12.0'})
    fields = parse(raw)
    code = next((v for fn, wt, v in fields if fn == 1 and wt == 0), 0)
    if code > (1 << 63): code -= 1 << 64
    err = next((s_(v) for fn, wt, v in fields if fn == 2 and wt == 2), '')
    if code < 0: raise RuntimeError(f'channel {type_name}: code={code} msg={err}')
    rsp = next((v for fn, wt, v in fields if fn == 3 and wt == 2), None)
    if rsp is None: return b''
    return next((v for fn, wt, v in parse(rsp) if fn == 2 and wt == 2), b'')


def login():
    if not (S.get('account') and S.get('pwd')): sys.exit('缺少账号: 配置 web/secrets.local.json 或 CIYUAN_ACC/CIYUAN_PWD')
    j = api_post_form('/u/login', {'account': S['account'], 'pwd': S['pwd']})
    if j.get('code') != 0: sys.exit(f'登录失败: {j}')
    d = j['data']
    print(f"username={d.get('username')} id={d.get('id')} isPro={d.get('isPro')} token={d['token'][:4]}…({len(d['token'])}字符)")
    return d['token']


# ---------- 子命令 ----------
def cmd_verify(_):
    """用仓库内抓包样本离线验证签名算法 (不需要网络/凭据, 但需要 SALT)."""
    if not SALT: sys.exit('需要 SALT (web/secrets.local.json 或 CIYUAN_SALT)')
    ok = fail = 0
    cases = [('rank', 't=1791896717547', 'dfac39b7932c8579c299d9a38b930278')]
    # login 样本输入由 secrets 动态构造 (凭据不入库; 期望 sign 对应 t=1791898159952 的历史抓包)
    if S.get('account') and S.get('pwd'):
        cases.append(('login', f"account={S['account']}&pwd={S['pwd']}&t=1791898159952", '33284cea2997a9142529e97e9e05364d'))
    for name, inp, exp in cases:
        got = sign(inp)
        print(f'  [{name}] {"OK" if got == exp else "FAIL"} {got}')
        ok += got == exp; fail += got != exp
    # /channel: 剥 f8 后 hex → sign, 应等于捕获的 f8
    for name, p in [('channel-未登录', 'data/ciyuan_channel_req.pb'),
                    ('channel-p1', 'data/ciyuan_home_channel_req.pb')]:
        b = open(os.path.join(ROOT, p), 'rb').read()
        if b'REDACTED_TOKEN' in b:  # 公开仓库脱敏版: token 被等长替换, 该样本签名已作废
            print(f'  [{name}] SKIP (token 已脱敏)')
            continue
        i = b.find(b'\x42\x20')
        while i != -1:
            cand = b[i+2:i+34]
            if len(cand) == 32 and all(chr(c) in '0123456789abcdef' for c in cand): break
            i = b.find(b'\x42\x20', i+1)
        nosig = b[:i] + b[i+34:]
        got, exp = sign(nosig.hex()), cand.decode()
        print(f'  [{name}] {"OK" if got == exp else "FAIL"} {got}')
        ok += got == exp; fail += got != exp
    print(f'verify: {ok} OK, {fail} FAIL')
    sys.exit(1 if fail else 0)


def cmd_rank(_):
    j = api_get_json('/rank', [('token', S.get('token') or '')])
    if j.get('code') != 0: sys.exit(f'rank 失败: {j}')
    total = sum(len(it['wallpapers']) for it in j['data']['items'])
    print(f"groups={[it['title'] for it in j['data']['items']]} total={total}")
    json.dump(j, sys.stdout, ensure_ascii=False) if '--json' in sys.argv else None


def cmd_feed(a):
    token = S.get('token') or login()
    cursor = a.cursor or INT64_MAX
    for page in range(a.pages):
        inner = t_v(1, cursor) + (t_b(2, a.comic) if a.comic else b'') + t_v(3, 0)
        ws = parse_wallpapers(channel('LoadWallpaperReq', inner, token))
        print(f'page{page+1}: {len(ws)} 条, cursor {cursor} -> {ws[-1]["createdAt"] if ws else None}')
        for w in ws[:3]:
            print('   ', w['id'][:8], w.get('author'), w.get('comic'), f"{w.get('width')}x{w.get('height')}", w.get('tags', [])[:3])
        if not ws: break
        cursor = ws[-1]['createdAt']
        if a.out:
            with open(a.out, 'a', encoding='utf-8') as f:
                for w in ws: f.write(json.dumps(w, ensure_ascii=False) + '\n')
            print('    -> appended', a.out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('verify').set_defaults(fn=cmd_verify)
    sub.add_parser('rank').set_defaults(fn=cmd_rank)
    sub.add_parser('login').set_defaults(fn=lambda _: login())
    f = sub.add_parser('feed'); f.add_argument('--cursor', type=int); f.add_argument('--comic'); f.add_argument('--pages', type=int, default=1); f.add_argument('--out')
    f.set_defaults(fn=cmd_feed)
    a = ap.parse_args()
    a.fn(a)


if __name__ == '__main__':
    main()
