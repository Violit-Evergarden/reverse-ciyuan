#!/usr/bin/env node
/**
 * 次元壁纸 Web 版后端 — 零 npm 依赖 (Node >= 18)
 *
 * 职责:
 *  - 复现 App 协议: sign = md5hex(md5hex(SALT + input));  /rank /u/login (t+sign 头),
 *    /channel (protobuf Channel 信封, sg 字段 = sign(hex(不含sg的序列化)))
 *  - token 管理: 从 secrets.local.json 读取账号, 自动登录/失效重登 (凭据不入库)
 *  - 图片代理: 缩略图(防盗链UA/混合内容) + 原图(*.a 单字节 XOR → webp)
 *  - 静态托管 public/ 与 JSON API
 *
 * 启动: node web/server.js   (默认 http://127.0.0.1:8787)
 */
'use strict';
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { URL, URLSearchParams } = require('node:url');

// ---------------- 配置 ----------------
const ROOT = __dirname;
const SECRETS_PATH = path.join(ROOT, 'secrets.local.json');
const CACHE_DIR = path.join(ROOT, '.cache');
// 前端产物: 优先 React 构建产物 web/dist (vite build), 回退旧版 public/
const PUBLIC_DIR = fs.existsSync(path.join(ROOT, 'dist', 'index.html')) ? path.join(ROOT, 'dist') : path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';

const API_BASE = 'https://api.awsl.13th.tech';
const UA_JSON = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0';
const UA_OKHTTP = 'okhttp/4.12.0';
const TYPE_URL_PREFIX = 'type.googleapis.com/me.alzz.awsl.proto.';
const INT64_MAX = 0x7fffffffffffffffn;
const APP = { v: 102, vn: '2.11.5', sh: 1632386598 };
// 设备环境字段 (base64 路径, 取自真机抓包; 服务端不校验内容)
const CD_B64 = 'L2RhdGEvZGF0YS9tZS5hbHp6LmF3c2wvY2FjaGU=';
const ND_B64 = 'L2RhdGEvYXBwL35+a0NrZ2NpV0NwS0N2RmRiMDNmcFE3UT09L21lLmFsenouYXdzbC0yX2VUTlR0NGJSNHVoXzFZUV';

let SECRETS = null; // { account, pwd, salt, token? }

function loadSecrets() {
  if (!fs.existsSync(SECRETS_PATH)) {
    console.error(`[!] 缺少 ${SECRETS_PATH} (凭据不入库, 需本地创建)。格式:
{
  "account": "你的账号邮箱",
  "pwd": "你的密码",
  "salt": "32位SALT (从 libhell.so 提取, 见 docs 报告 §8)",
  "token": "可选, 已有登录 token"
}`);
    process.exit(1);
  }
  SECRETS = JSON.parse(fs.readFileSync(SECRETS_PATH, 'utf8'));
  if (!SECRETS.salt) { console.error('[!] secrets.local.json 缺少 salt'); process.exit(1); }
}
function saveToken(token) {
  SECRETS.token = token;
  try {
    const cur = JSON.parse(fs.readFileSync(SECRETS_PATH, 'utf8'));
    cur.token = token;
    fs.writeFileSync(SECRETS_PATH, JSON.stringify(cur, null, 2));
  } catch (e) { console.warn('[warn] token 持久化失败:', e.message); }
}

// ---------------- 签名 ----------------
const md5hex = (buf) => crypto.createHash('md5').update(buf).digest('hex');
function sign(input /* string|Buffer */) {
  const salt = Buffer.from(SECRETS.salt, 'utf8');
  const h1 = md5hex(Buffer.concat([salt, Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8')]));
  return md5hex(Buffer.from(h1, 'utf8')); // 双重 md5, 输出小写 hex
}

// ---------------- protobuf wire (手写编解码) ----------------
function wv(n) { // varint (BigInt or Number)
  let v = typeof n === 'bigint' ? n : BigInt(n);
  if (v < 0n) v += 1n << 64n;
  const out = [];
  for (;;) { const b = Number(v & 0x7fn); v >>= 7n; out.push(v ? b | 0x80 : b); if (!v) break; }
  return Buffer.from(out);
}
const tVarint = (fn, v) => Buffer.concat([wv((fn << 3) | 0), wv(v)]);
const tBytes = (fn, b) => { b = Buffer.isBuffer(b) ? b : Buffer.from(b, 'utf8'); return Buffer.concat([wv((fn << 3) | 2), wv(b.length), b]); };

function parseMsg(buf) { // -> [{fn, wt, v}]  (wt0: BigInt varint, wt2: Buffer, wt1/5: Buffer)
  const out = []; let i = 0;
  const rdVarint = () => { let r = 0n, s = 0n; for (;;) { const x = buf[i++]; r |= BigInt(x & 0x7f) << s; if (!(x & 0x80)) return r; s += 7n; } };
  while (i < buf.length) {
    const key = rdVarint(); const fn = Number(key >> 3n), wt = Number(key & 7n);
    if (wt === 0) out.push({ fn, wt, v: rdVarint() });
    else if (wt === 2) { const ln = Number(rdVarint()); out.push({ fn, wt, v: buf.subarray(i, i + ln) }); i += ln; }
    else if (wt === 5) { out.push({ fn, wt, v: buf.subarray(i, i + 4) }); i += 4; }
    else if (wt === 1) { out.push({ fn, wt, v: buf.subarray(i, i + 8) }); i += 8; }
    else throw new Error('bad wiretype ' + wt);
  }
  return out;
}
const str = (b) => Buffer.isBuffer(b) ? b.toString('utf8') : String(b);
const num = (v) => typeof v === 'bigint' ? (v > 9007199254740991n ? v.toString() : Number(v)) : v;

function parseWallpapers(rspValue) { // LoadWallpaperRsp{ f1: repeated Wallpaper }
  const list = [];
  for (const f of parseMsg(rspValue)) {
    if (f.fn !== 1 || f.wt !== 2) continue;
    const w = { tags: [], characters: [] };
    for (const g of parseMsg(f.v)) {
      switch (g.fn) {
        case 1: w.id = str(g.v); break;
        case 2: w.author = str(g.v); break;
        case 3: w.isR16 = num(g.v) !== 0; break;
        case 4: w.pixivId = g.wt === 2 ? str(g.v) : num(g.v); break; // proto 里是 string 字段(可能是 pixiv 数字 ID, 也可能是 32 位 hex 外部 ID)
        case 5: { const tg = str(g.v); if (tg.trim()) w.tags.push(tg); break; } // 上游存在空标签脏数据
        case 6: w.thumbUrl = str(g.v); break;
        case 7: w.url = str(g.v); break;
        case 8: w.width = num(g.v); break;
        case 9: w.height = num(g.v); break;
        case 10: w.comic = str(g.v); break;
        case 11: { const ch = str(g.v); if (ch.trim()) w.characters.push(ch); break; }
        case 12: w.uploader = str(g.v); break;
        case 13: w.createdAt = num(g.v); break;
      }
    }
    list.push(w);
  }
  return list;
}

function buildChannel(innerMsg, typeName, token) {
  const t = Date.now();
  const anyMsg = Buffer.concat([tBytes(1, TYPE_URL_PREFIX + typeName), tBytes(2, innerMsg)]);
  const part1 = Buffer.concat([
    tBytes(1, anyMsg),
    token ? tBytes(2, token) : Buffer.alloc(0),
    tVarint(4, APP.v), tBytes(5, APP.vn), tBytes(6, UA_JSON), tVarint(7, t),
  ]);
  const part2 = Buffer.concat([tBytes(9, Buffer.from(CD_B64, 'utf8')), tVarint(10, APP.sh), tBytes(11, Buffer.from(ND_B64, 'utf8'))]);
  const pre = Buffer.concat([part1, part2]);           // 不含 sg 的规范序列化
  const sg = sign(pre.toString('hex'));                // sign(hex(bytes))
  return Buffer.concat([part1, tBytes(8, sg), part2]); // sg=f8 按字段号序插入
}

// ---------------- HTTP 客户端 ----------------
function requestOnce(urlStr, { method = 'GET', headers = {}, body = null, timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'http:' ? http : https; // 按 URL 协议选择 (原图 CDN 为 http)
    const req = mod.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search, method,
      headers: { 'accept-encoding': 'identity', ...headers }, timeout,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  });
}
async function request(urlStr, opts = {}, _depth = 0) { // 跟随 3xx 重定向 (imgdb 缩略图为 302 服务)
  const res = await requestOnce(urlStr, opts);
  if (res.status >= 300 && res.status < 400 && res.headers.location && _depth < 5) {
    const next = new URL(res.headers.location, urlStr).toString();
    return request(next, { ...opts, body: null, method: 'GET' }, _depth + 1);
  }
  return res;
}

// ---------------- App API 封装 ----------------
function signedPairs(pairs) { // pairs: [k,v][] → 排序去重 k=v (跳过空值) + t
  const t = String(Date.now());
  const set = new Set();
  for (const [k, v] of pairs) if (String(v ?? '').trim() !== '') set.add(`${k}=${v}`);
  set.add(`t=${t}`);
  return { t, sign: sign([...set].sort().join('&')) };
}

async function apiLogin() {
  if (!SECRETS.account || !SECRETS.pwd) {
    throw new Error('后端未配置账号: 编辑 web/secrets.local.json 填入 account+pwd (或直接填 token)');
  }
  const form = { account: SECRETS.account, pwd: SECRETS.pwd };
  const { t, sign: sg } = signedPairs(Object.entries(form));
  const body = new URLSearchParams(form).toString();
  const res = await request(`${API_BASE}/u/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA_JSON, 'accept': 'application/json,text/json', t, sign: sg, 'content-length': Buffer.byteLength(body) },
    body,
  });
  const j = JSON.parse(res.body.toString('utf8'));
  if (j.code !== 0 || !j.data?.token) throw new Error(`登录失败: code=${j.code} msg=${j.msg}`);
  saveToken(j.data.token);
  console.log(`[+] login ok: ${j.data.username} (token ${j.data.token.slice(0, 4)}…)`);
  return j.data;
}

async function apiRank() {
  const { t, sign: sg } = signedPairs([['token', '']]); // token 空 → 跳过, 仅 t
  const res = await request(`${API_BASE}/rank?token=`, {
    headers: { 'user-agent': UA_JSON, t, sign: sg, 'accept': 'application/json,text/json' },
  });
  const j = JSON.parse(res.body.toString('utf8'));
  if (j.code !== 0) throw new Error(`rank 失败: code=${j.code} msg=${j.msg}`);
  return j.data;
}

let relogging = null;
async function ensureToken(force = false) {
  if (!force && SECRETS.token) return SECRETS.token;
  if (!relogging) relogging = apiLogin().then((d) => d.token).finally(() => { relogging = null; });
  return relogging;
}

async function apiChannel(typeName, innerMsg, { retry = true } = {}) {
  const token = await ensureToken();
  const body = buildChannel(innerMsg, typeName, token);
  const res = await request(`${API_BASE}/channel`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-protobuf', 'user-agent': UA_OKHTTP, 'content-length': body.length },
    body,
  });
  const fields = parseMsg(res.body);
  const codeF = fields.find((f) => f.fn === 1 && f.wt === 0);
  const code = codeF ? Number(BigInt.asIntN(64, codeF.v)) : 0;
  const errmsg = str(fields.find((f) => f.fn === 2 && f.wt === 2)?.v ?? '');
  if (code < 0) {
    if (retry && /重新登录|登录/.test(errmsg)) { // token 失效 → 重登录再试一次
      console.log('[!] token 失效, 重新登录…', errmsg);
      SECRETS.token = null;
      return apiChannel(typeName, innerMsg, { retry: false });
    }
    const e = new Error(`channel ${typeName} 失败: code=${code} msg=${errmsg}`); e.apiCode = code; throw e;
  }
  const rspAny = fields.find((f) => f.fn === 3 && f.wt === 2);
  if (!rspAny) return null;
  const anyVal = parseMsg(rspAny.v).find((f) => f.fn === 2 && f.wt === 2);
  return anyVal ? anyVal.v : null;
}

const loadWallpapers = async ({ cursor = INT64_MAX, comic = '', landscape = 0, pixivId = 0 } = {}) => {
  const parts = [tVarint(1, cursor)];
  if (comic) parts.push(tBytes(2, comic));
  parts.push(tVarint(3, landscape));
  if (pixivId) parts.push(tVarint(4, pixivId));
  const val = await apiChannel('LoadWallpaperReq', Buffer.concat(parts));
  if (!val) return [];
  return parseWallpapers(val);
};

// 服务端真搜索 (SearchWallpaperReq) — 需 Pro 账户; 非 Pro 返回 code=-5, 由前端回落本地过滤
const searchWallpapers = async ({ cursor = INT64_MAX, keyword = '' } = {}) => {
  const parts = [tVarint(1, cursor), tBytes(2, keyword)];
  const val = await apiChannel('SearchWallpaperReq', Buffer.concat(parts));
  if (!val) return [];
  return parseWallpapers(val);
};

// ---------------- 图片: XOR 解码 + 缓存 ----------------
const isPlainImage = (b) => b.subarray(0, 4).toString('latin1') === 'RIFF'
  || (b[0] === 0xff && b[1] === 0xd8)
  || (b[0] === 0x89 && b.subarray(1, 4).toString('latin1') === 'PNG');
function xorDecodeWebp(buf) {
  if (buf.length > 12 && isPlainImage(buf)) return buf; // 未混淆 (webp/jpeg/png 直连源)
  const key = buf[0] ^ 0x52;
  const out = Buffer.from(buf);
  for (let i = 0; i < out.length; i++) out[i] ^= key;
  if (isPlainImage(out)) return out;
  throw new Error('XOR 解码失败: 非 RIFF/WEBP/JPEG/PNG (上游可能返回了错误页)');
}
function sniffType(buf) { // 缩略图重定向后可能是 jpeg (imgdb→百度CDN), 按 magic 判定
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.length > 4 && buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  return 'application/octet-stream';
}
const cacheKey = (u) => crypto.createHash('sha1').update(u).digest('hex');
const inflight = new Map();
let writeCount = 0;
async function pruneCache() { // 磁盘缓存 LRU 上限 1.5GB, 超了按 mtime 删最旧
  const CAP = 1.5 * 1024 ** 3;
  try {
    const ents = await fsp.readdir(CACHE_DIR, { withFileTypes: true });
    const files = [];
    let total = 0;
    for (const e of ents) {
      if (!e.isFile()) continue;
      const st = await fsp.stat(path.join(CACHE_DIR, e.name));
      total += st.size;
      files.push({ name: e.name, mtime: st.mtimeMs, size: st.size });
    }
    if (total <= CAP) return;
    files.sort((a, b) => a.mtime - b.mtime);
    for (const f of files) {
      if (total <= CAP * 0.8) break;
      await fsp.unlink(path.join(CACHE_DIR, f.name)).catch(() => {});
      total -= f.size;
    }
  } catch {}
}
async function fetchUpstream(imgUrl) {
  // 注意: 不能带 referer — imgdb 302→百度 bcebos CDN, 其防盗链对带 referer 的请求返回 403
  const res = await request(imgUrl, { headers: { 'user-agent': UA_JSON }, timeout: 60000 });
  if (res.status !== 200) throw new Error(`图片 ${res.status}: ${imgUrl}`);
  return res.body;
}
async function cachedFetchImage(imgUrl, decodeXor) {
  const key = cacheKey(imgUrl) + (decodeXor ? '.orig.webp' : '.raw');
  const fp = path.join(CACHE_DIR, key);
  try { return await fsp.readFile(fp); } catch {}
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    let body = await fetchUpstream(imgUrl);
    let data;
    try {
      data = decodeXor ? xorDecodeWebp(body) : body;
    } catch (e) {
      // 上游偶发 200 错误页(地理/限流): 重试一次, 坏数据绝不入缓存
      body = await fetchUpstream(imgUrl);
      data = decodeXor ? xorDecodeWebp(body) : body;
    }
    fsp.writeFile(fp, data).catch(() => {});
    if (++writeCount % 32 === 0) void pruneCache();
    return data;
  })();
  inflight.set(key, p);
  try { return await p; } finally { inflight.delete(key); }
}

// ---------------- 简单内存缓存 ----------------
const memCache = new Map(); // key -> {exp, val}
function cacheWrap(key, ttlMs, fn) {
  const hit = memCache.get(key);
  if (hit && hit.exp > Date.now()) return Promise.resolve(hit.val);
  return fn().then((val) => { memCache.set(key, { exp: Date.now() + ttlMs, val }); return val; });
}

// ---------------- HTTP 服务 ----------------
const json = (res, code, obj) => {
  const b = Buffer.from(JSON.stringify({ code, ...obj }), 'utf8');
  res.writeHead(code === 0 ? 200 : 502, { 'content-type': 'application/json; charset=utf-8', 'content-length': b.length, 'cache-control': 'no-store' });
  res.end(b);
};
const img = (res, buf, type = 'image/webp', ttl = 86400 * 7) => {
  res.writeHead(200, { 'content-type': type, 'content-length': buf.length, 'cache-control': `public, max-age=${ttl}` });
  res.end(buf);
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

// ---------------- 站点门禁 (cookie 会话, 180 天) ----------------
// 取代 nginx Basic Auth: iOS 上 Basic Auth 凭据仅存内存, 杀 Safari/web clip 即失效;
// cookie 为持久化存储, 输一次密码后重启不再询问。凭据 = secrets.local.json 的 gate 字段。
const GATE_DAYS = 180;
const gateSecret = () => crypto.createHash('md5').update((SECRETS.gate || '') + '|ciyuan-gate').digest('hex');
const gateHmac = (exp) => crypto.createHmac('sha256', gateSecret()).update(exp).digest('hex');
function gateCookieOk(req) {
  if (!SECRETS.gate) return true;
  const m = /(?:^|;\s*)cy_gate=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return false;
  const [exp, sig] = decodeURIComponent(m[1]).split('.');
  return !!sig && sig === gateHmac(exp) && Number(exp) > Date.now();
}
const gateHtml = (err) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>站点密码</title><style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0e14;color:#e8ecf4;font-family:system-ui,-apple-system,sans-serif}
form{background:#161b27;border:1px solid #232b3d;border-radius:16px;padding:28px 26px;display:flex;flex-direction:column;gap:14px;width:min(320px,86vw)}
h1{font-size:17px;margin:0;text-align:center}
input{padding:12px 14px;border-radius:10px;border:1px solid #232b3d;background:#11151f;color:#e8ecf4;font-size:15px;outline:none}
button{padding:12px;border-radius:10px;border:0;background:linear-gradient(135deg,#7c5cff,#ff5ca8);color:#fff;font-size:15px;font-weight:600}
.e{color:#ff4d6a;font-size:12.5px;text-align:center;min-height:16px;margin:0}
</style></head><body><form method="post" action="/gate">
<h1>🌸 站点密码</h1><p class="e">${err}</p>
<input type="password" name="code" placeholder="输入站点密码" autofocus autocomplete="current-password">
<button type="submit">进入</button></form>
<script>
// fetch 提交 + replace 跳转: 不在历史里留下门禁页/POST 条目, 移动端返回手势不会回到输入框
document.querySelector('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await fetch('/gate', { method: 'POST', body: new URLSearchParams(new FormData(e.target)) });
  if (r.redirected || r.ok) location.replace('/');
  else document.querySelector('.e').textContent = '密码不对: 注意大小写, 已自动忽略首尾空格与全角字符';
});
// 带有效 cookie 落回本页 (如浏览器后退到缓存) → 直接放行
fetch('/api/status').then((r) => { if (r.ok) location.replace('/'); }).catch(() => {});
</script>
</body></html>`;

async function serveStatic(req, res, pathname) {
  let fp = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!fp.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  try {
    const st = await fsp.stat(fp);
    if (st.isDirectory()) fp = path.join(fp, 'index.html');
    const buf = await fsp.readFile(fp);
    // vite 产物带内容哈希 → 长缓存; 其余 no-cache
    const cc = pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : (pathname === '/' || pathname === '/index.html' ? 'no-store' : 'no-cache');
    res.writeHead(200, { 'content-type': MIME[path.extname(fp)] || 'application/octet-stream', 'content-length': buf.length, 'cache-control': cc });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>页面不存在</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0e14;color:#eceff5;font-family:'Outfit','PingFang SC','Microsoft YaHei',system-ui,sans-serif}main{text-align:center}svg{width:64px;height:64px;color:#e58ab5;opacity:.85}h1{font-size:26px;letter-spacing:-.015em;margin:14px 0 6px}p{color:#99a2b4;font-size:14px;margin:0 0 20px}a{color:#e58ab5;text-decoration:none;border:1px solid rgba(229,138,181,.45);padding:9px 18px;border-radius:10px;font-weight:600}a:hover{background:rgba(184,67,122,.16)}</style></head>
<body><main><svg viewBox="0 0 24 24"><g fill="currentColor"><ellipse cx="12" cy="6.6" rx="3" ry="4.4"/><ellipse cx="12" cy="6.6" rx="3" ry="4.4" transform="rotate(72 12 12)"/><ellipse cx="12" cy="6.6" rx="3" ry="4.4" transform="rotate(144 12 12)"/><ellipse cx="12" cy="6.6" rx="3" ry="4.4" transform="rotate(216 12 12)"/><ellipse cx="12" cy="6.6" rx="3" ry="4.4" transform="rotate(288 12 12)"/></g></svg>
<h1>页面不存在</h1><p>地址可能已变更或从未存在</p><a href="/">回到首页</a></main></body></html>`);
  }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = u.pathname;
  // 门禁: POST /gate 校验密码发 cookie; 其余请求无 cookie 时拦截
  if (p === '/gate' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      // 容错: 复制粘贴常带尾空白/换行, 输入法易出全角 → trim + NFKC 归一后再比 (密码仍区分大小写)
      const norm = (x) => String(x || '').trim().normalize('NFKC');
      // 兼容两种编码: fetch+FormData 会发 multipart (浏览器表单默认), URLSearchParams 发 urlencoded
      const ct = req.headers['content-type'] || '';
      let raw = '';
      if (ct.includes('multipart/form-data')) {
        const m = /name="code"\r\n\r\n([\s\S]*?)\r\n--/.exec(body);
        raw = m ? m[1] : '';
      } else {
        raw = new URLSearchParams(body).get('code') || '';
      }
      const code = norm(raw);
      if (SECRETS.gate && code === norm(SECRETS.gate)) {
        const exp = String(Date.now() + GATE_DAYS * 86400e3);
        res.writeHead(302, {
          'set-cookie': `cy_gate=${exp}.${gateHmac(exp)}; Path=/; Max-Age=${GATE_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`,
          location: '/',
        });
        return res.end();
      }
      res.writeHead(401, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(gateHtml('密码不对, 再试一次'));
    });
    return;
  }
  if (!gateCookieOk(req)) {
    if (p.startsWith('/api/')) {
      const b = Buffer.from(JSON.stringify({ code: 401, msg: '未通过站点门禁' }), 'utf8');
      res.writeHead(401, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(b);
    }
    res.writeHead(401, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(gateHtml(''));
  }
  try {
    if (p === '/api/rank') {
      const data = await cacheWrap('rank', 10 * 60e3, apiRank);
      return json(res, 0, { data });
    }
    if (p === '/api/wallpapers') {
      const cursorRaw = u.searchParams.get('cursor');
      const cursor = cursorRaw && cursorRaw !== 'latest' ? BigInt(cursorRaw) : INT64_MAX;
      const comic = u.searchParams.get('comic') || '';
      const key = `wp:${cursorRaw || 'latest'}:${comic}`;
      const ws = await cacheWrap(key, 5 * 60e3, () => loadWallpapers({ cursor, comic }));
      const next = ws.length ? String(ws[ws.length - 1].createdAt) : null;
      return json(res, 0, { wallpapers: ws, nextCursor: next, count: ws.length });
    }
    if (p === '/api/search') {
      const keyword = u.searchParams.get('keyword') || '';
      if (!keyword) { res.writeHead(400); return res.end('keyword required'); }
      const cursorRaw = u.searchParams.get('cursor');
      const cursor = cursorRaw ? BigInt(cursorRaw) : INT64_MAX;
      const key = `sr:${cursorRaw || 'latest'}:${keyword}`;
      const ws = await cacheWrap(key, 5 * 60e3, () => searchWallpapers({ cursor, keyword }));
      const next = ws.length ? String(ws[ws.length - 1].createdAt) : null;
      return json(res, 0, { wallpapers: ws, nextCursor: next, count: ws.length });
    }
    if (p === '/api/comics') { // 聚合最近 3 页得到作品索引 (comic 名 + 数量 + 封面)
      const data = await cacheWrap('comics', 30 * 60e3, async () => {
        const acc = new Map(); let cursor = INT64_MAX;
        for (let i = 0; i < 3; i++) {
          const ws = await loadWallpapers({ cursor });
          if (!ws.length) break;
          for (const w of ws) if (w.comic) {
            const c = acc.get(w.comic) || { name: w.comic, count: 0, thumbUrl: w.thumbUrl };
            c.count++; acc.set(w.comic, c);
          }
          cursor = BigInt(ws[ws.length - 1].createdAt);
        }
        return [...acc.values()].sort((a, b) => b.count - a.count);
      });
      return json(res, 0, { comics: data });
    }
    if (p === '/api/img/thumb') {
      const target = u.searchParams.get('u');
      if (!target || !/^https?:\/\//.test(target)) { res.writeHead(400); return res.end('bad url'); }
      const buf = await cachedFetchImage(target, false);
      return img(res, buf, sniffType(buf), 86400 * 30);
    }
    if (p === '/api/img/orig') {
      const target = u.searchParams.get('u');
      if (!target || !/^https?:\/\//.test(target)) { res.writeHead(400); return res.end('bad url'); }
      const buf = await cachedFetchImage(target, true); // *.a → XOR; 直连源原样透传
      return img(res, buf, sniffType(buf), 86400 * 30);
    }
    if (p === '/api/status') {
      return json(res, 0, { app: APP, hasToken: !!SECRETS.token, hasAccount: !!(SECRETS.account && SECRETS.pwd) });
    }
    if (p.startsWith('/api/')) { res.writeHead(404); return res.end('{"code":404}'); }
    return await serveStatic(req, res, p);
  } catch (e) {
    console.error('[api error]', p, e.message);
    return json(res, e.apiCode || -1, { msg: e.message });
  }
});

(async () => {
  loadSecrets();
  await fsp.mkdir(CACHE_DIR, { recursive: true });
  server.listen(PORT, HOST, async () => {
    console.log(`次元壁纸 Web 版 → http://${HOST}:${PORT}`);
    try { await ensureToken(!SECRETS.token); } catch (e) { console.warn('[warn] 预登录失败(将惰性重试):', e.message); }
  });
})();
