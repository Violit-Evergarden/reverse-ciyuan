import { useEffect, useMemo, useRef, useState } from 'react';
import { thumbOf } from '../api';
import { cardH, distribute, masonrySpec } from '../masonry';
import { fetchPage, openModal, searchPool, state, useV, visible } from '../store';
import { ensureOrig } from '../orig';
import type { Wallpaper } from '../types';
import { FilterBar } from './FilterBar';

const mountedIds = new Set<string>(); // 入场动画仅首次挂载播放, tab 切回不重放 (防抖动)
function Card({ w, d }: { w: Wallpaper; d: number }) {
  const first = !mountedIds.has(w.id);
  useEffect(() => { mountedIds.add(w.id); }, [w.id]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const ratio = (w.width && w.height) ? (w.height / w.width) : 1.414;
  return (
    <div className={'card' + (first ? '' : ' no-anim')} style={{ animationDelay: `${d}ms` }} onClick={() => openModal(w)} onPointerDown={() => { ensureOrig(w).catch(() => { /* 弹窗/下载时再报 */ }); }}>
      <div className="thumb-wrap" style={{ aspectRatio: `${(1 / ratio).toFixed(4)}` }}>
        {!loaded && !failed && <div className="skeleton" />}
        <img
          className={'thumb' + (loaded ? ' loaded' : '')}
          loading="lazy"
          alt={w.author || ''}
          src={thumbOf(w)}
          onLoad={() => setLoaded(true)}
          onError={() => { setFailed(true); }}
        />
        {w.isR16 && <span className="badge-r16">R16</span>}
        <div className="meta">
          <span className="author">{w.author || '匿名'}</span>
          {w.comic && <span className="comic">· {w.comic}</span>}
          <span className="dim">{w.width}×{w.height}</span>
        </div>
      </div>
    </div>
  );
}

export function HomeView() {
  useV();
  const wrapRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => setWidth(es[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) void fetchPage(); }, { rootMargin: '800px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const w = width || Math.max(320, window.innerWidth - 44);
  const { n, gap } = masonrySpec(w, window.innerWidth);
  const colW = (w - gap * (n - 1)) / n;
  const items = searchPool().filter(visible); // 有搜索词时作用域=全部已加载池并集
  const cols = useMemo(
    () => distribute(items, (it) => cardH(it, colW, gap), n, gap),
    [items, n, colW, gap],
  );

  const empty = state.cache.done && !state.cache.pool.length;

  return (
    <section className="view active">
      <FilterBar />
      <div className="masonry" ref={wrapRef} style={{ columnGap: gap }}>
        {empty
          ? (
            <div className="empty-state">
              <svg className="empty-mark" viewBox="0 0 24 24" aria-hidden="true">
                <g fill="currentColor">
                  <ellipse cx="12" cy="6.6" rx="3" ry="4.4" />
                  <ellipse cx="12" cy="6.6" rx="3" ry="4.4" transform="rotate(72 12 12)" />
                  <ellipse cx="12" cy="6.6" rx="3" ry="4.4" transform="rotate(144 12 12)" />
                  <ellipse cx="12" cy="6.6" rx="3" ry="4.4" transform="rotate(216 12 12)" />
                  <ellipse cx="12" cy="6.6" rx="3" ry="4.4" transform="rotate(288 12 12)" />
                </g>
              </svg>
              <p>没有匹配的壁纸<br />换个关键词，或下滑加载更多数据</p>
            </div>
            )
          : cols.map((col, i) => (
            <div className="mcol" key={i}>
              {col.map((it, r) => <Card key={it.id} w={it} d={Math.min(i * 3 + r, 12) * 26} />)}
            </div>
          ))}
      </div>
      <div className="load-state" style={{ display: state.loading ? '' : 'none' }}>
        <div className="spinner" />加载中…
      </div>
      <div id="sentinel" ref={sentinelRef} />
    </section>
  );
}
