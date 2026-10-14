import { useState } from 'react';
import { thumbOf } from '../api';
import { state, useV } from '../store';

export function CatsView() {
  useV();
  return (
    <section className="view active">
      <div className="section-head"><div className="section-title">分类</div></div>
      <div className="comics-grid">
        {(state.comics || []).map((c) => <ComicCard key={c.name} c={c} />)}
      </div>
      {!state.comics && (
        <div className="load-state"><div className="spinner" />加载中…</div>
      )}
    </section>
  );
}

function ComicCard({ c }: { c: { name: string; count: number; thumbUrl: string } }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="comic-card" onClick={() => { location.hash = `#/comic/${encodeURIComponent(c.name)}`; }}>
      <div className="cover">
        <img className={loaded ? 'loaded' : ''} loading="lazy" src={thumbOf(c)} alt="" onLoad={() => setLoaded(true)} />
      </div>
      <div className="info">
        <div className="name" title={c.name}>{c.name}</div>
      </div>
    </div>
  );
}
