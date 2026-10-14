import { useState } from 'react';
import { thumbOf } from '../api';
import { openModal, setRankTab, state, useV } from '../store';
import type { Wallpaper } from '../types';

const fmtDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function RankView() {
  useV();
  const items = state.rank?.items;
  if (!items) return (
    <section className="view active">
      <div className="section-head"><div className="section-title">排行</div></div>
      <div className="load-state"><div className="spinner" />加载排行…</div>
    </section>
  );
  const group = items[state.rankTab];
  return (
    <section className="view active">
      <div className="section-head"><div className="section-title">排行</div></div>
      <div className="rank-tabs">
        {items.map((g, i) => (
          <button key={g.title} className={i === state.rankTab ? 'active' : ''} onClick={() => setRankTab(i)}>{g.title}</button>
        ))}
      </div>
      <div className="rank-list">
        {group.wallpapers.map((w, i) => <RankItem key={w.id} w={w} i={i} />)}
      </div>
    </section>
  );
}

function RankItem({ w, i }: { w: Wallpaper; i: number }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="rank-item" onClick={() => openModal(w)}>
      <div className="cover">
        <img className={loaded ? 'loaded' : ''} loading="lazy" src={thumbOf(w)} alt="" onLoad={() => setLoaded(true)} />
      </div>
      <span className={'rank-no' + (i < 3 ? ` top${i + 1}` : '')}>{i + 1}</span>
      <div className="info">
        <div className="t">{w.author || '匿名'}</div>
        <div className="s">{w.comic || ''} {w.comic ? '·' : ''} {fmtDate(w.createdAt)}</div>
      </div>
    </div>
  );
}
