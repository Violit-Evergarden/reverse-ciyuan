import { useEffect, useMemo, useRef, useState } from 'react';
import { thumbOf } from '../api';
import { cardH, distribute, masonrySpec } from '../masonry';
import { fetchPage, openModal, state, useV, visible } from '../store';
import { ensureOrig } from '../orig';
import type { Wallpaper } from '../types';
import { FilterBar } from './FilterBar';

function Card({ w }: { w: Wallpaper }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const ratio = (w.width && w.height) ? (w.height / w.width) : 1.414;
  return (
    <div className="card" onClick={() => openModal(w)} onPointerDown={() => { ensureOrig(w).catch(() => { /* 弹窗/下载时再报 */ }); }}>
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
  const items = useMemo(() => state.cache.pool.filter(visible), [state.cache, state.cache.pool.length, state.query, state.scope, state.hideR16]);
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
          ? <div className="empty-state"><div className="big">🌌</div><p>没有匹配的壁纸<br />换个关键词，或下滑加载更多数据</p></div>
          : cols.map((col, i) => (
            <div className="mcol" key={i}>
              {col.map((it) => <Card key={it.id} w={it} />)}
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
