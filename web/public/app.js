/* 次元壁纸 Web — 前端逻辑 (ES module, 零依赖) */

// ---------- 工具 ----------
const $ = (s) => document.querySelector(s);
const enc = encodeURIComponent;
const thumbOf = (w) => `/api/img/thumb?u=${enc(w.thumbUrl)}`;
const origOf = (w) => `/api/img/orig?u=${enc(w.url)}`;
const fmtDate = (ms) => { const d = new Date(Number(ms)); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const fmtSize = (w, h) => `${w} × ${h}`;

async function api(path) {
  const r = await fetch(path);
  const j = await r.json();
  if (j.code !== 0) throw new Error(j.msg || `API 错误 (${j.code})`);
  return j;
}
function toast(msg, isErr = false, ms = 3200) {
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// ---------- 状态 ----------
const state = {
  view: 'discover',          // discover | comics | rank
  comic: null,               // 作品过滤 (服务端)
  query: '',                 // 本地过滤
  cursor: null,              // 分页游标 (null=最新)
  loading: false,
  done: false,
  pool: [],                  // 已加载的全部壁纸 (搜索池)
  seen: new Set(),
  rank: null,                // {items:[{title,wallpapers}]}
  rankTab: 0,
  comics: null,              // [{name,count,thumbUrl}]
  hideR16: localStorage.getItem('ciyuan_hideR16') === '1',
  modal: null,               // 当前打开的 wallpaper
};

// ---------- 瀑布流布局 (复刻 APP StaggeredGridLayoutManager 语义) ----------
// CSS multi-column 是"列优先"填充(第 1 列自上而下装满才轮到第 2 列), 视觉顺序 ≠ 数据顺序,
// 且每次 append 全容器重新均衡列高, 已显示的卡片会跳位。改为自维护 N 个列容器:
// 每张卡放入累计高度最小的列 → 行优先、只追加不重排, 与 APP 竖向瀑布流同语义;
// 卡片高度由数据里的 width/height 先算出(aspect-ratio 内联), 无需等图片加载、不回流。
const MAS = { ideal: 280, gapDesk: 14, gapMobile: 10, maxCols: 5 };
function masonrySpec(width) {
  if (window.innerWidth <= 900) return { n: 2, gap: MAS.gapMobile }; // 与 APP 手机端 2 列对齐
  const n = Math.max(2, Math.min(MAS.maxCols, Math.floor((width + MAS.gapDesk) / (MAS.ideal + MAS.gapDesk))));
  return { n, gap: MAS.gapDesk };
}
const cardH = (w, colW, gap) => colW * ((w.width && w.height) ? (w.height / w.width) : 1.414) + gap;

let layout = null; // { n, gap, colW, width, cols:[{el, h}] }
const gridWidth = () => $('#grid').clientWidth || Math.max(320, window.innerWidth - 44);
function buildLayout() {
  const grid = $('#grid');
  grid.innerHTML = '';
  const width = gridWidth();
  const { n, gap } = masonrySpec(width);
  grid.style.columnGap = gap + 'px';
  const colW = (width - gap * (n - 1)) / n;
  const cols = [];
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div');
    el.className = 'mcol';
    grid.appendChild(el);
    cols.push({ el, h: 0 });
  }
  layout = { n, gap, colW, width, cols };
  return layout;
}
const layoutStale = () => !layout || !layout.cols[0].el.isConnected || gridWidth() !== layout.width;
function placeCard(w) {
  let best = layout.cols[0];
  for (const c of layout.cols) if (c.h < best.h) best = c;
  best.el.appendChild(cardEl(w));
  best.h += cardH(w, layout.colW, layout.gap);
}

// ---------- 过滤 ----------
function matchQuery(w, q) {
  if (!q) return true;
  q = q.toLowerCase();
  return (w.author || '').toLowerCase().includes(q)
    || (w.comic || '').toLowerCase().includes(q)
    || (w.id || '').toLowerCase().startsWith(q)
    || (w.tags || []).some((t) => t.toLowerCase().includes(q))
    || (w.characters || []).some((t) => t.toLowerCase().includes(q))
    || String(w.pixivId || '').includes(q);
}
const visible = (w) => !(state.hideR16 && w.isR16) && matchQuery(w, state.query);

// ---------- 卡片渲染 ----------
function cardEl(w) {
  const card = document.createElement('div');
  card.className = 'card';
  const ratio = (w.width && w.height) ? (w.height / w.width) : 1.414;
  card.innerHTML = `
    <div class="thumb-wrap" style="aspect-ratio:${(1 / ratio).toFixed(4)}">
      <div class="skeleton"></div>
      <img class="thumb" loading="lazy" alt="${enc(w.author || '')}" src="${thumbOf(w)}">
      ${w.isR16 ? '<span class="badge-r16">R16</span>' : ''}
      <div class="meta">
        <span class="author">${esc(w.author || '匿名')}</span>
        ${w.comic ? `<span class="comic">· ${esc(w.comic)}</span>` : ''}
        <span class="dim">${w.width}×${w.height}</span>
      </div>
    </div>`;
  const img = card.querySelector('img');
  img.onload = () => { img.classList.add('loaded'); card.querySelector('.skeleton')?.remove(); };
  img.onerror = () => { card.querySelector('.skeleton')?.remove(); img.alt = '图片加载失败'; };
  card.onclick = () => openModal(w);
  return card;
}
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function renderPool() { // 全量重排 (搜索/R16/resize): 按 pool 原序重新做最短列摆放
  buildLayout();
  let n = 0;
  for (const w of state.pool) if (visible(w)) { placeCard(w); n++; }
  updateCountPill(n);
}
function appendCards(list) { // 增量追加: 只摆新卡, 已显示的卡不移动 (与 APP 一致)
  if (layoutStale()) buildLayout();
  for (const w of list) if (visible(w)) placeCard(w);
  updateCountPill($('#grid').querySelectorAll('.card').length);
}
function updateCountPill(n) {
  const parts = [];
  if (state.comic) parts.push(`作品「${state.comic}」`);
  if (state.query) parts.push(`过滤 “${state.query}”`);
  $('#discover-count').innerHTML = parts.length
    ? `<b>${n}</b> / ${state.pool.length} 张 · ${parts.join(' · ')}`
    : `已加载 <b>${state.pool.length}</b> 张`;
  $('#discover-title').innerHTML = state.comic
    ? `<span class="grad">${esc(state.comic)}</span>`
    : state.query ? `<span class="grad">搜索</span> 结果` : '<span class="grad">发现</span> 最新壁纸';
  const hint = $('#search-hint');
  if (state.query) {
    hint.style.display = '';
    hint.textContent = '本地过滤实时流（服务端搜索需 APP Pro 账户）；继续下滑可扩大搜索池';
  } else hint.style.display = 'none';
  $('#comic-back').style.display = state.comic ? '' : 'none';
}

// ---------- 数据加载 ----------
async function fetchPage() {
  if (state.loading || state.done) return;
  state.loading = true;
  $('#loader').style.display = '';
  try {
    const qs = new URLSearchParams();
    if (state.cursor) qs.set('cursor', state.cursor);
    if (state.comic) qs.set('comic', state.comic);
    const j = await api(`/api/wallpapers?${qs}`);
    const fresh = j.wallpapers.filter((w) => !state.seen.has(w.id));
    fresh.forEach((w) => state.seen.add(w.id));
    state.pool.push(...fresh);
    appendCards(fresh);
    state.cursor = j.nextCursor;
    state.done = !j.nextCursor || j.count === 0;
    if (state.done && !state.pool.length) showEmpty();
  } catch (e) {
    toast('加载失败: ' + e.message, true);
    $('#loader').innerHTML = `加载失败：${esc(e.message)} <button onclick="location.reload()">重试</button>`;
    state.loading = false;
    return;
  }
  state.loading = false;
  $('#loader').style.display = 'none';
  $('#loader').innerHTML = '<div class="spinner"></div>加载中…';
}
function showEmpty() {
  layout = null;
  $('#grid').innerHTML = `<div class="empty-state"><div class="big">🌌</div><p>没有匹配的壁纸<br>换个关键词，或下滑加载更多数据</p></div>`;
}
function resetStream(comic = null) {
  state.comic = comic;
  state.cursor = null; state.done = false; state.pool = []; state.seen.clear();
  layout = null;
  $('#grid').innerHTML = '';
  switchView('discover');
  fetchPage();
}

// ---------- 排行 ----------
async function loadRank() {
  if (state.rank) { renderRank(); return; }
  $('#rank-list').innerHTML = '<div class="load-state"><div class="spinner"></div>加载排行…</div>';
  try {
    const j = await api('/api/rank');
    state.rank = j.data;
    renderRank();
  } catch (e) { $('#rank-list').innerHTML = `<div class="load-state">排行加载失败: ${esc(e.message)}</div>`; }
}
function renderRank() {
  const items = state.rank.items;
  $('#rank-tabs').innerHTML = '';
  items.forEach((g, i) => {
    const b = document.createElement('button');
    b.textContent = g.title;
    b.className = i === state.rankTab ? 'active' : '';
    b.onclick = () => { state.rankTab = i; renderRank(); };
    $('#rank-tabs').appendChild(b);
  });
  const list = $('#rank-list');
  list.innerHTML = '';
  items[state.rankTab].wallpapers.forEach((w, i) => {
    const el = document.createElement('div');
    el.className = 'rank-item';
    el.innerHTML = `
      <div class="cover"><img loading="lazy" src="${thumbOf(w)}" alt=""></div>
      <span class="rank-no ${i < 3 ? 'top' + (i + 1) : ''}">${i + 1}</span>
      <div class="info"><div class="t">${esc(w.author || '匿名')}</div>
      <div class="s">${esc(w.comic || '')} ${w.comic ? '·' : ''} ${fmtDate(w.createdAt)}</div></div>`;
    const img = el.querySelector('img');
    img.onload = () => img.classList.add('loaded');
    el.onclick = () => openModal(w);
    list.appendChild(el);
  });
}

// ---------- 作品 ----------
async function loadComics() {
  if (state.comics) { renderComics(); return; }
  $('#comics-loading').style.display = '';
  try {
    const j = await api('/api/comics');
    state.comics = j.comics;
    renderComics();
  } catch (e) { toast('作品聚合失败: ' + e.message, true); }
  $('#comics-loading').style.display = 'none';
}
function renderComics() {
  const grid = $('#comics-grid');
  grid.innerHTML = '';
  for (const c of state.comics) {
    const el = document.createElement('div');
    el.className = 'comic-card';
    el.innerHTML = `
      <div class="cover"><img loading="lazy" src="${thumbOf(c)}" alt=""></div>
      <div class="info"><div class="name" title="${esc(c.name)}">${esc(c.name)}</div>
      <div class="count">近期 <b>${c.count}</b> 张</div></div>`;
    const img = el.querySelector('img');
    img.onload = () => img.classList.add('loaded');
    el.onclick = () => { location.hash = `#/comic/${enc(c.name)}`; };
    grid.appendChild(el);
  }
}

// ---------- 详情弹窗 ----------
let origLoading = null;
function openModal(w) {
  state.modal = w;
  const m = $('#modal');
  const imgEl = $('#modal-img');
  imgEl.classList.remove('loading-orig');
  imgEl.src = thumbOf(w);
  $('#m-title').textContent = w.comic || w.author || '壁纸';
  const rows = [
    ['作者', esc(w.author || '匿名')],
    ['作品', w.comic ? `<a href="#/comic/${enc(w.comic)}" onclick="document.getElementById('modal').classList.remove('open')">${esc(w.comic)}</a>` : '—'],
    ['尺寸', fmtSize(w.width, w.height)],
    ['Pixiv ID', w.pixivId ? (/^\d{1,10}$/.test(String(w.pixivId))
      ? `<a href="https://www.pixiv.net/artworks/${w.pixivId}" target="_blank" rel="noopener" title="原作可能已被删除或转为私有">${w.pixivId} ↗</a>`
      : `<span style="font-family:monospace;font-size:11px" title="非 pixiv 作品 ID(站外源标识)">${esc(String(w.pixivId))}</span>`) : '—'],
    ['上传日期', fmtDate(w.createdAt)],
    ['角色', (w.characters || []).map(esc).join('、') || '—'],
    ['ID', `<span style="font-family:monospace;font-size:11px">${esc(w.id)}</span>`],
  ];
  $('#m-rows').innerHTML = rows.map(([k, v]) => `<div class="side-row"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
  $('#m-tags').innerHTML = (w.tags || []).map((t) => `<button class="tag-chip" data-tag="${esc(t)}">${esc(t)}</button>`).join('');
  $('#m-tags').querySelectorAll('.tag-chip').forEach((b) => {
    b.onclick = () => { closeModal(); $('#search-input').value = b.dataset.tag; onSearch(b.dataset.tag); };
  });
  const dl = $('#m-download');
  dl.href = origOf(w);
  dl.download = `${w.comic || 'ciyuan'}_${w.id.slice(0, 8)}.webp`;
  const pixiv = $('#m-pixiv');
  if (w.pixivId && /^\d{1,10}$/.test(String(w.pixivId))) { // 仅纯数字才是 pixiv 作品 ID (32hex 为站外源标识, 不外链)
    pixiv.style.display = '';
    pixiv.href = `https://www.pixiv.net/artworks/${w.pixivId}`;
    pixiv.title = '原作可能已被删除或转为私有';
  } else pixiv.style.display = 'none';
  m.classList.add('open');
  document.body.style.overflow = 'hidden';
  // 后台渐进加载原图 (XOR 解码流), 完成后无缝替换
  const hint = $('#orig-hint');
  hint.style.display = 'flex';
  $('#orig-hint-text').textContent = '原图加载中…';
  if (origLoading) origLoading.cancel = true;
  const job = { cancel: false };
  origLoading = job;
  const pre = new Image();
  pre.onload = () => {
    if (job.cancel || state.modal !== w) return;
    imgEl.classList.add('loading-orig');
    setTimeout(() => { imgEl.src = pre.src; imgEl.classList.remove('loading-orig'); }, 160);
    hint.style.display = 'none';
  };
  pre.onerror = () => { if (!job.cancel) { $('#orig-hint-text').textContent = '原图加载失败（可点下载重试）'; } };
  pre.src = origOf(w);
}
function closeModal() {
  if (origLoading) origLoading.cancel = true;
  $('#modal').classList.remove('open');
  $('#modal-img').src = '';
  document.body.style.overflow = '';
  state.modal = null;
}
$('#modal-close').onclick = closeModal;
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' || e.target.classList.contains('modal-img-pane')) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

// ---------- 视图切换 / 路由 ----------
function switchView(v) {
  state.view = v;
  document.querySelectorAll('.view').forEach((el) => el.classList.remove('active'));
  $('#view-' + v).classList.add('active');
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
}
function applyHash() {
  const h = location.hash || '#/discover';
  if (h.startsWith('#/comic/')) {
    const name = decodeURIComponent(h.slice(8));
    if (state.comic !== name || state.view !== 'discover') resetStream(name);
    else switchView('discover');
  } else if (h === '#/comics') { switchView('comics'); loadComics(); }
  else if (h === '#/rank') { switchView('rank'); loadRank(); }
  else { if (state.view !== 'discover') switchView('discover'); }
}
window.addEventListener('hashchange', applyHash);
document.querySelectorAll('#nav button').forEach((b) => {
  b.onclick = () => { location.hash = '#/' + b.dataset.view; };
});
$('#comic-back').onclick = () => { location.hash = '#/comics'; };

// ---------- 搜索 (本地过滤) ----------
let searchTimer = null;
function onSearch(q) {
  state.query = q.trim();
  $('#searchbox').classList.toggle('has-value', !!state.query);
  if (state.view !== 'discover') switchView('discover');
  renderPool();
  // 池子太小则自动补页
  if (state.query && state.pool.filter(visible).length < 12 && !state.done) fetchPage();
}
$('#search-input').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => onSearch(e.target.value), 220);
});
$('#search-clear').onclick = () => { $('#search-input').value = ''; onSearch(''); };

// ---------- R16 开关 ----------
$('#r16-toggle').checked = state.hideR16;
$('#r16-toggle').addEventListener('change', (e) => {
  state.hideR16 = e.target.checked;
  localStorage.setItem('ciyuan_hideR16', state.hideR16 ? '1' : '0');
  renderPool();
});

// ---------- 无限滚动 ----------
new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting && state.view === 'discover' && !state.query?.length) fetchPage();
  else if (entries[0].isIntersecting && state.view === 'discover' && state.pool.filter(visible).length < 20 && !state.done) fetchPage();
}, { rootMargin: '800px' }).observe($('#sentinel'));

// ---------- 窗宽变化: 仅列数/列宽真正改变时重排 (按 pool 原序重摆, 图片走缓存) ----------
let rsTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(rsTimer);
  rsTimer = setTimeout(() => { if (state.view === 'discover' && layoutStale()) renderPool(); }, 150);
});

// ---------- 启动 ----------
applyHash();
if (state.view === 'discover' && !state.pool.length) fetchPage();
api('/api/status').then((j) => {
  if (!j.hasToken && !j.hasAccount) toast('后端未配置账号，仅 /rank 可用', true, 5000);
}).catch(() => {});
