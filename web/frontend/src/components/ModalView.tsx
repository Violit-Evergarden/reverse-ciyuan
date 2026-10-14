import { useEffect, useRef, useState } from 'react';
import { thumbOf } from '../api';
import { ensureOrig, getCachedOrig } from '../orig';
import { closeModal, onSearch, setScope, state, toast, useV } from '../store';

const fmtDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function ModalView() {
  useV();
  const w = state.modal;
  const [origState, setOrigState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [prog, setProg] = useState<{ loaded: number; total: number } | null>(null);
  const [origUrl, setOrigUrl] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);            // 移动端信息/下载弹层
  const [tf, setTf] = useState({ s: 1, x: 0, y: 0 });   // 缩放/平移
  const blobRef = useRef<Blob | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d0: number; s0: number; mx: number; my: number } | null>(null);
  const moved = useRef(false);
  const tapTimer = useRef<number | null>(null);

  // 预取 (卡片 pointerdown / 弹窗打开即开始, orig.ts 单一 in-flight): 真实进度 → 小圆盘;
  // 完成后 blob 在手 → 下载一次点击即分享。
  useEffect(() => {
    if (!w) return;
    let cancelled = false;
    setProg(null);
    setSheet(false);
    setTf({ s: 1, x: 0, y: 0 });
    setOrigUrl(null); // 杜绝背景残留上一张
    blobRef.current = null;
    const onProg = (p: { loaded: number; total: number }) => { if (!cancelled) setProg(p); };
    const cached = getCachedOrig(w.id);
    if (cached) {
      blobRef.current = cached;
      setOrigUrl(URL.createObjectURL(cached));
      setProg({ loaded: cached.size, total: cached.size });
      setOrigState('ready');
    } else {
      setOrigState('loading');
      ensureOrig(w, onProg).then((blob) => {
        if (cancelled) return;
        blobRef.current = blob;
        setOrigUrl(URL.createObjectURL(blob));
        setOrigState('ready');
      }).catch(() => { if (!cancelled) setOrigState('error'); });
    }
    return () => { cancelled = true; };
  }, [w]);
  useEffect(() => () => { if (origUrl) URL.revokeObjectURL(origUrl); }, [origUrl]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') closeModal(); };
    document.addEventListener('keydown', f);
    return () => document.removeEventListener('keydown', f);
  }, []);
  useEffect(() => {
    document.body.style.overflow = w ? 'hidden' : '';
  }, [w]);

  // ---------- 捏合缩放 / 拖动 / 单击换弹层 ----------
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d0: Math.hypot(a.x - b.x, a.y - b.y), s0: tf.s, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = pointers.current.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) moved.current = true;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const s = Math.min(4, Math.max(1, pinch.current.s0 * (d / pinch.current.d0)));
      setTf((t) => ({ ...t, s }));
    } else if (pointers.current.size === 1 && tf.s > 1) {
      setTf((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size !== 0 || moved.current || tf.s !== 1) return;
    // 单击/双击判别: 260ms 内第二次点按 → 缩放; 否则单击换弹层 (避免连点时开-关互相抵消)
    if (tapTimer.current !== null) {
      window.clearTimeout(tapTimer.current);
      tapTimer.current = null;
      setTf((t) => (t.s > 1 ? { s: 1, x: 0, y: 0 } : { s: 2.5, x: 0, y: 0 }));
    } else {
      tapTimer.current = window.setTimeout(() => { tapTimer.current = null; setSheet((s) => !s); }, 260);
    }
  };

  if (!w) return null;
  const pixivNum = w.pixivId && /^\d{1,10}$/.test(String(w.pixivId));
  const pct = prog && prog.total ? Math.min(1, prog.loaded / prog.total) : 0;
  const syncing = origState === 'loading';

  // 下载 = 一次点击: blob 在手直接分享; 同步中点按 await 同一 in-flight, 完成即刻在手势窗口内分享;
  // 仅当 iOS 因手势过期拒绝时按钮转脉冲态提示再点一次 (平台手势时效限制, 无法再省)。
  const downloadOrig = async () => {
    let blob = getCachedOrig(w.id) || blobRef.current;
    if (!blob) {
      try { blob = await ensureOrig(w); } catch (e) { setOrigState('error'); toast('下载失败: ' + (e as Error).message, true); return; }
    }
    const name = `${w.comic || 'ciyuan'}_${w.id.slice(0, 8)}.webp`;
    const file = new File([blob], name, { type: 'image/webp' });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: w.comic || w.author || '次元壁纸' });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
      setOrigState('ready');
    } catch (e) {
      if ((e as Error).name === 'AbortError') setOrigState('ready');
      else { setOrigState('ready'); toast('保存失败: ' + (e as Error).message, true); }
    }
  };

  const rows: [string, React.ReactNode][] = [
    ['作者', w.author || '匿名'],
    ['分类', w.comic
      ? <button className="linklike" onClick={() => { closeModal(); setScope({ type: 'comic', value: w.comic as string }); }}>「{w.comic}」全部</button>
      : '—'],
    ['尺寸', `${w.width} × ${w.height}`],
    ['Pixiv ID', pixivNum
      ? <a href={`https://www.pixiv.net/artworks/${w.pixivId}`} target="_blank" rel="noopener" title="原作可能已被删除或转为私有">{w.pixivId} ↗</a>
      : w.pixivId
        ? <span style={{ fontFamily: 'monospace', fontSize: 11 }} title="非 pixiv 作品 ID(站外源标识)">{w.pixivId}</span>
        : '—'],
    ['上传日期', fmtDate(w.createdAt)],
    ['角色', w.characters.join('、') || '—'],
    ['上传者', w.uploader
      ? <button className="linklike" title="查看该上传者的全部转载" onClick={() => { closeModal(); setScope({ type: 'uploader', value: w.uploader as string }); }}>{w.uploader.slice(0, 10)}…</button>
      : '—'],
  ];

  return (
    <div className="modal open" onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
      <div
        className="modal-stage"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <img
          className={syncing ? 'loading-orig' : ''}
          src={origUrl || thumbOf(w)}
          alt=""
          style={{ transform: `translate(${tf.x}px, ${tf.y}px) scale(${tf.s})` }}
        />
        {syncing && prog && (
          <div className="orig-ring" role="progressbar" aria-valuenow={Math.round(pct * 100)}>
            <svg viewBox="0 0 40 40">
              <circle className="ring-bg" cx="20" cy="20" r="17" />
              <circle className="ring-fg" cx="20" cy="20" r="17" strokeDasharray={2 * Math.PI * 17} strokeDashoffset={2 * Math.PI * 17 * (1 - pct)} />
            </svg>
            <span>{prog.total ? `${Math.round(pct * 100)}%` : '…'}</span>
          </div>
        )}
        {origState === 'error' && (
          <div className="orig-hint"><span className="dot" /><span>原图加载失败（点下载重试）</span></div>
        )}
        <button className="modal-close" onClick={closeModal} title="关闭 (Esc)">✕</button>
        {tf.s > 1 && <div className="zoom-hint">{tf.s.toFixed(1)}× · 双击还原 · 单击看信息</div>}
      </div>
      <aside className={'modal-side' + (sheet ? ' open' : '')}>
        <div className="sheet-handle" onClick={() => setSheet(false)} />
        <h2>{w.comic || w.author || '壁纸'}</h2>
        <div>
          {rows.map(([k, v]) => (
            <div className="side-row" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>
          ))}
        </div>
        <div className="tag-cloud">
          {w.tags.map((t) => (
            <button
              className="tag-chip"
              key={t}
              onClick={() => {
                closeModal();
                const input = document.querySelector<HTMLInputElement>('.searchbox input');
                if (input) input.value = t;
                onSearch(t);
              }}
            >{t}</button>
          ))}
        </div>
        <div className="side-actions">
          <button className="btn btn-primary" onClick={() => void downloadOrig()}>
            {syncing ? `⏳ 原图同步 ${prog?.total ? Math.round(pct * 100) + '%' : '…'}（点按保存）`
              : origState === 'error' ? '↻ 重试下载原图' : '⬇ 下载原图'}
          </button>
          {pixivNum && (
            <a className="btn btn-ghost" href={`https://www.pixiv.net/artworks/${w.pixivId}`} target="_blank" rel="noopener" title="原作可能已被删除或转为私有">Pixiv 来源 ↗</a>
          )}
        </div>
      </aside>
    </div>
  );
}
