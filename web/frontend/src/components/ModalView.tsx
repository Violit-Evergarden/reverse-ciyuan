// 详情弹窗: 只做组合。
//   原图加载/画质 → modal/useOriginal   手势 → modal/useStageGestures   弹层拖拽 → modal/useSheetDrag
//   保存意图 → ../save (全局, 与弹窗生命周期解耦: 关闭弹窗不会丢失保存)
import { useEffect, useState } from 'react';
import { thumbOf } from '../api';
import { onModalOpened, requestSave } from '../save';
import { closeModal, onSearch, openModal, searchPool, setScope, state, useV, visible } from '../store';
import { exceedsBudget, isDesktop, useOriginal, type Quality } from './modal/useOriginal';
import { useStageGestures } from './modal/useStageGestures';
import { useSheetDrag } from './modal/useSheetDrag';
import { IconDownload, IconRetry, PieRing, QualitySwitch, buildRows } from './modal/parts';

export function ModalView() {
  useV();
  const w = state.modal;
  const [sheet, setSheet] = useState(false);
  const [quality, setQuality] = useState<Quality>('fit');
  const orig = useOriginal(w, quality);

  const navigate = (dir: 1 | -1) => {
    const list = searchPool().filter(visible);
    const i = list.findIndex((x) => x.id === w?.id);
    const t = i >= 0 ? list[i + dir] : undefined;
    if (t) openModal(t, { replace: true }); // 切图不压历史栈
  };
  const gestures = useStageGestures({
    onTap: () => setSheet((s) => !s),
    onSwipe: navigate,
    onSwipeDown: () => (sheet ? setSheet(false) : closeModal()),
  });
  const sheetDrag = useSheetDrag(() => setSheet(false));

  // 换图时复位视图状态
  useEffect(() => {
    setSheet(false);
    setQuality('fit');
    gestures.reset();
    if (w) onModalOpened(w.id);
  }, [w?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') closeModal(); };
    document.addEventListener('keydown', f);
    return () => document.removeEventListener('keydown', f);
  }, []);
  useEffect(() => { document.body.style.overflow = w ? 'hidden' : ''; }, [w]);

  if (!w) return null;

  const loading = orig.state === 'loading';
  const save = state.save?.id === w.id ? state.save.phase : 'idle';
  const pctText = orig.hasProgress ? `${Math.round(orig.pct * 100)}%` : '…';
  const tags = w.tags.filter((t) => t.trim());
  const rows = buildRows(w, {
    comic: () => { closeModal(); setScope({ type: 'comic', value: w.comic as string }); },
    uploader: () => { closeModal(); setScope({ type: 'uploader', value: w.uploader as string }); },
  });
  const pixivUrl = w.pixivId && /^\d{1,10}$/.test(String(w.pixivId)) ? `https://www.pixiv.net/artworks/${w.pixivId}` : null;

  let primary: React.ReactNode;
  if (save === 'waiting') primary = <>保存中 {pctText}</>;
  else if (save === 'armed') primary = <><IconDownload />原图已就绪 · 点按保存</>;
  else if (orig.state === 'error') primary = <><IconRetry />重试加载原图</>;
  else if (loading) primary = <><IconDownload />保存原图 {orig.hasProgress ? `· ${pctText}` : ''}</>;
  else primary = <><IconDownload />保存原图</>;

  const onPrimary = () => {
    if (orig.state === 'error') { orig.retry(); return; }
    void requestSave(w);
  };

  return (
    <div className="modal open" onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="modal-stage" {...gestures.bind}>
        <div className="modal-figure">
          <img
            key={w.id}
            src={orig.url || thumbOf(w)}
            alt={w.comic || w.author || '壁纸'}
            style={{ transform: `translate(${gestures.tf.x}px, ${gestures.tf.y}px) scale(${gestures.tf.s})` }}
          />
          {loading && orig.hasProgress && <PieRing pct={orig.pct} />}
          {orig.state === 'error' && <div className="orig-hint"><span className="dot" /><span>原图加载失败</span></div>}
        </div>
        <button className="modal-close" onClick={closeModal} aria-label="关闭">✕</button>
        {gestures.tf.s > 1 && <div className="zoom-hint">{gestures.tf.s.toFixed(1)}× · 双击还原</div>}
      </div>

      <aside ref={sheetDrag.ref} className={'modal-side' + (sheet ? ' open' : '')} {...sheetDrag.bind}>
        <div className="sheet-handle" onClick={() => setSheet(false)} />
        <h2>{w.comic || w.author || '壁纸'}</h2>
        <div className="side-rows">
          {rows.map((r) => (
            <div className="side-row" key={r.k}><span className="k">{r.k}</span><span className="v">{r.v}</span></div>
          ))}
        </div>
        {tags.length > 0 && (
          <div className="tag-cloud">
            {tags.map((t) => (
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
        )}
        {!isDesktop() && exceedsBudget(w) && (
          <div className="quality-row">
            <span className="k">显示画质</span>
            <QualitySwitch value={quality} onChange={setQuality} />
          </div>
        )}
        <div className="side-actions">
          <button className={'btn btn-primary' + (save === 'armed' ? ' armed' : '')} onClick={onPrimary}>
            {primary}
          </button>
          {pixivUrl && (
            <a className="btn btn-ghost" href={pixivUrl} target="_blank" rel="noopener" title="原作可能已被删除或转为私有">Pixiv 来源 ↗</a>
          )}
        </div>
      </aside>
    </div>
  );
}
