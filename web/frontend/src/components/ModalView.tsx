import { useEffect, useState } from 'react';
import { origOf, thumbOf } from '../api';
import { closeModal, onSearch, setScope, state, toast, useV } from '../store';

const fmtDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function ModalView() {
  useV();
  const w = state.modal;
  const [origState, setOrigState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [dl, setDl] = useState<'idle' | 'packing'>('idle');
  useEffect(() => {
    if (!w) return;
    setOrigState('loading');
    const pre = new Image();
    pre.onload = () => setOrigState('ready');
    pre.onerror = () => setOrigState('error');
    pre.src = origOf(w);
  }, [w]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') closeModal(); };
    document.addEventListener('keydown', f);
    return () => document.removeEventListener('keydown', f);
  }, []);
  useEffect(() => {
    document.body.style.overflow = w ? 'hidden' : '';
  }, [w]);
  if (!w) return null;

  const pixivNum = w.pixivId && /^\d{1,10}$/.test(String(w.pixivId));

  // iOS 主屏幕(standalone)模式无下载管理器 UI, <a download> 静默失败;
  // 改为 fetch → 系统分享面板(存照片/文件/AirDrop), 普通浏览器回落 blob 下载。
  const downloadOrig = async () => {
    if (dl !== 'idle') return;
    setDl('packing');
    try {
      const r = await fetch(origOf(w));
      if (!r.ok) throw new Error(String(r.status));
      const blob = await r.blob();
      const name = `${w.comic || 'ciyuan'}_${w.id.slice(0, 8)}.webp`;
      const file = new File([blob], name, { type: 'image/webp' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: w.comic || w.author || '次元壁纸' });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast('下载失败: ' + (e as Error).message, true);
    } finally {
      setDl('idle');
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
    <div className="modal open" onClick={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('modal-img-pane')) closeModal(); }}>
      <button className="modal-close" onClick={closeModal}>✕</button>
      <div className="modal-body">
        <div className="modal-img-pane">
          <img className={origState === 'loading' ? 'loading-orig' : ''} src={origState === 'ready' ? origOf(w) : thumbOf(w)} alt="" />
          {origState !== 'ready' && (
            <div className="orig-hint">
              <span className="dot" />
              <span>{origState === 'error' ? '原图加载失败（可点下载重试）' : '原图加载中…'}</span>
            </div>
          )}
        </div>
        <aside className="modal-side">
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
            <button className="btn btn-primary" disabled={dl !== 'idle'} onClick={() => void downloadOrig()}>
              {dl === 'packing' ? '⏳ 原图打包中…' : '⬇ 下载原图'}
            </button>
            {pixivNum && (
              <a className="btn btn-ghost" href={`https://www.pixiv.net/artworks/${w.pixivId}`} target="_blank" rel="noopener" title="原作可能已被删除或转为私有">Pixiv 来源 ↗</a>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
