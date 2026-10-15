// 全局状态 + actions (外部 store + useSyncExternalStore, 零依赖)。
// 交互模型: tab = 首页/分类/排行; 流视图承载 scope (null|comic|uploader|search);
// 每个 scope 独立缓存 {pool,seen,cursor,done}, 切换瞬时恢复+游标续载;
// gen 代际 token 丢弃 scope 切换时在途请求的过期结果。
import { useSyncExternalStore } from 'react';
import { apiComics, apiRank, apiSearch, apiStatus, apiWallpapers, ApiError } from './api';
import type { Comic, RankGroup, Scope, View, Wallpaper } from './types';

interface Cache { pool: Wallpaper[]; seen: Set<string>; cursor: string | null; done: boolean }
interface Toast { id: number; msg: string; err: boolean; action?: { label: string; fn: () => void } }

export const state = {
  view: 'home' as View,
  scope: null as Scope,
  query: '',
  caches: new Map<string, Cache>(),
  cache: null as unknown as Cache,
  loading: false,
  gen: 0,
  serverSearch: null as boolean | null,
  rank: null as { items: RankGroup[] } | null,
  rankTab: 0,
  comics: null as Comic[] | null,
  hideR16: localStorage.getItem('ciyuan_hideR16') === '1',
  modal: null as Wallpaper | null,
  save: null as { id: string; phase: 'idle' | 'waiting' | 'armed' } | null, // 保存意图 (见 save.ts)
  toasts: [] as Toast[],
};

let version = 0;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getVersion = () => version;
export const bump = () => { version++; listeners.forEach((l) => l()); };
export const useV = () => useSyncExternalStore(subscribe, getVersion);

// ---------- scope / cache ----------
export const scopeKey = (sc: Scope) => (!sc ? 'global' : `${sc.type}:${sc.value}`);
function cacheFor(sc: Scope): Cache {
  const k = scopeKey(sc);
  let c = state.caches.get(k);
  if (!c) { c = { pool: [], seen: new Set(), cursor: null, done: false }; state.caches.set(k, c); }
  return c;
}
export const scopeHash = (sc: Scope) => !sc ? '#/home'
  : sc.type === 'comic' ? `#/comic/${encodeURIComponent(sc.value)}`
    : sc.type === 'uploader' ? `#/uploader/${encodeURIComponent(sc.value)}`
      : `#/search/${encodeURIComponent(sc.value)}`;
export const scopeFromHash = (h: string): Scope =>
  h.startsWith('#/comic/') ? { type: 'comic', value: decodeURIComponent(h.slice(8)) }
    : h.startsWith('#/uploader/') ? { type: 'uploader', value: decodeURIComponent(h.slice(11)) }
      : h.startsWith('#/search/') ? { type: 'search', value: decodeURIComponent(h.slice(9)) }
        : null;

// ---------- 过滤 ----------
export function matchQuery(w: Wallpaper, q: string) {
  if (!q) return true;
  q = q.toLowerCase();
  return (w.author || '').toLowerCase().includes(q)
    || (w.comic || '').toLowerCase().includes(q)
    || (w.id || '').toLowerCase().startsWith(q)
    || (w.tags || []).some((t) => t.toLowerCase().includes(q))
    || (w.characters || []).some((t) => t.toLowerCase().includes(q))
    || String(w.pixivId || '').includes(q);
}
export const inScope = (w: Wallpaper) => !state.scope
  || (state.scope.type === 'comic' ? w.comic === state.scope.value
    : state.scope.type === 'uploader' ? w.uploader === state.scope.value
      : true); // search scope 已由服务端过滤
export const visible = (w: Wallpaper) => !(state.hideR16 && w.isR16) && inScope(w) && matchQuery(w, state.query);

// ---------- toast ----------
let toastId = 0;
export function toast(msg: string, err = false, ms = 3200, action?: { label: string; fn: () => void }) {
  const t = { id: ++toastId, msg, err, action };
  state.toasts.push(t); bump();
  setTimeout(() => { state.toasts = state.toasts.filter((x) => x.id !== t.id); bump(); }, ms);
}

// ---------- 数据加载 ----------
export async function fetchPage() {
  const c = state.cache;
  if (state.loading || c.done || state.view !== 'home') return;
  const gen = state.gen;
  state.loading = true; bump();
  try {
    const j = state.scope?.type === 'search'
      ? await apiSearch(state.scope.value, c.cursor)
      : await apiWallpapers(c.cursor, state.scope?.type === 'comic' ? state.scope.value : null);
    if (gen !== state.gen) return;
    const fresh = j.wallpapers.filter((w) => !c.seen.has(w.id));
    fresh.forEach((w) => c.seen.add(w.id));
    c.pool.push(...fresh);
    c.cursor = j.nextCursor;
    c.done = !j.nextCursor || j.count === 0;
  } catch (e) {
    if (gen !== state.gen) return;
    toast('加载失败: ' + (e as Error).message, true);
    state.loading = false; bump();
    return;
  }
  if (gen !== state.gen) return;
  state.loading = false; bump();
}

export function setScope(scope: Scope, { navigate = true } = {}) {
  state.scope = scope;
  state.loading = false; state.gen++;
  state.cache = cacheFor(scope);
  if (navigate && location.hash !== scopeHash(scope)) location.hash = scopeHash(scope);
  state.view = 'home';
  bump();
  if (!state.cache.done) void fetchPage();
}

// ---------- 搜索 (有 Pro → 服务端 scope; 无 Pro → 池内过滤回落) ----------
async function probeServerSearch(q: string) {
  try {
    await apiSearch(q, null);
    state.serverSearch = true;
  } catch (e) {
    state.serverSearch = false;
    if (e instanceof ApiError && e.code === -5) toast('服务端搜索需 Pro 账户，已用本地过滤', false, 2600);
  }
}
export function onSearch(q: string) {
  const t = q.trim();
  if (state.serverSearch) {
    setScope(t ? { type: 'search', value: t } : (state.scope?.type === 'search' ? null : state.scope));
    return;
  }
  state.query = t;
  if (state.view !== 'home') state.view = 'home';
  bump();
  if (t) void expandForQuery();
  if (t && state.serverSearch === null) void probeServerSearch(t).then(() => {
    if (state.serverSearch && state.query) {
      const kw = state.query; state.query = '';
      setScope({ type: 'search', value: kw });
    }
  });
}
export function clearQuery() { state.query = ''; bump(); }

// 搜索/标签过滤的作用域 = 全部已加载池的并集 (去重 + 按时间倒序):
// "分类里点标签 → 去掉分类 chip" 时, 标签命中项仍留在已加载的分类池里, 不应凭空消失。
export function searchPool(): Wallpaper[] {
  if (!state.query) return state.cache.pool;
  const seen = new Set<string>();
  const out: Wallpaper[] = [];
  for (const c of state.caches.values()) {
    for (const w of c.pool) if (!seen.has(w.id)) { seen.add(w.id); out.push(w); }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

// 池内过滤的覆盖率补偿: 结果太少时自动续载后续页 (稀有标签可能不在已加载池里)
async function expandForQuery(min = 12, maxPages = 6) {
  for (let i = 0; i < maxPages; i++) {
    const c = state.cache;
    if (c.done || searchPool().filter(visible).length >= min) break;
    await fetchPage();
  }
}

// ---------- 其他 views ----------
export async function loadRank() {
  if (state.rank) return;
  try { state.rank = (await apiRank()).data; } catch (e) { toast('排行加载失败: ' + (e as Error).message, true); }
  bump();
}
export async function loadComics() {
  if (state.comics) return;
  try { state.comics = (await apiComics()).comics; } catch (e) { toast('分类聚合失败: ' + (e as Error).message, true); }
  bump();
}
export function setRankTab(i: number) { state.rankTab = i; bump(); }
export function toggleR16(v: boolean) {
  state.hideR16 = v;
  localStorage.setItem('ciyuan_hideR16', v ? '1' : '0');
  bump();
}
export const openModal = (w: Wallpaper, opts?: { replace?: boolean }) => {
  state.modal = w;
  savedScroll = window.scrollY;
  const base = (location.hash || '#/home').split('/w/')[0];
  const target = `${base}/w/${w.id}`;
  if (location.hash !== target) {
    // 左右滑切图用 replace: 不污染历史栈 (一次返回仍回列表)
    if (opts?.replace) location.replace(target);
    else location.hash = target;
  }
  bump();
};
export const closeModal = () => {
  if (!state.modal) return;
  state.modal = null;
  if ((location.hash || '').includes('/w/')) history.back(); // hashchange → applyHash 收尾
  requestAnimationFrame(() => window.scrollTo({ top: savedScroll, behavior: 'instant' as ScrollBehavior }));
  bump();
};
let savedScroll = 0;

// ---------- 路由 ----------
// 哈希格式: #/home | #/cats | #/rank | #/comic/<名> | #/uploader/<ID> | #/search/<词>,
// 详情弹窗追加后缀 /w/<壁纸ID> (同文档历史条目, 侧滑零重载)。
const viewScroll: Partial<Record<View, number>> = {};
export function applyHash(h: string) {
  const prevView = state.view;
  const wi = h.indexOf('/w/');
  const base = wi >= 0 ? h.slice(0, wi) : h;
  const wId = wi >= 0 ? h.slice(wi + 3) : null;
  const sc = scopeFromHash(base);
  if (sc) {
    if (scopeHash(state.scope) !== scopeHash(sc)) setScope(sc, { navigate: false });
    else state.view = 'home';
  } else if (base === '#/cats') { state.view = 'cats'; void loadComics(); }
  else if (base === '#/rank') { state.view = 'rank'; void loadRank(); }
  else if (state.scope) setScope(null, { navigate: false });
  else state.view = 'home';
  if (wId) {
    let found: Wallpaper | null = null;
    for (const c of state.caches.values()) {
      found = c.pool.find((x) => x.id === wId) || null;
      if (found) break;
    }
    state.modal = found; // 深链且池内无此图 → 视为关闭
  } else {
    state.modal = null;
  }
  bump();
  if (state.view !== prevView) {
    viewScroll[prevView] = window.scrollY;          // 记录离开视图的滚动位
    const target = viewScroll[state.view] || 0;
    // 双 rAF: 等 React 提交+布局完成后再恢复, 否则文档高度不足滚动被钳到 0
    requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: target, behavior: 'instant' as ScrollBehavior })));
  }
}

// ---------- 启动 ----------
history.scrollRestoration = 'manual'; // 滚动权收归应用: 禁止浏览器历史恢复覆盖视图级恢复
state.cache = cacheFor(null);
void apiStatus().then((j) => {
  if (!j.hasToken && !j.hasAccount) toast('后端未配置账号，仅排行可用', true, 5000);
}).catch(() => { /* 后端未起 */ });
