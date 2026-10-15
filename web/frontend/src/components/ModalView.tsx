import { useEffect, useRef, useState } from 'react';
import { thumbOf } from '../api';
import { ensureOrig, getCachedOrig } from '../orig';
import type { Wallpaper } from '../types';
import { closeModal, onSearch, openModal, setScope, state, toast, useV, visible } from '../store';

const fmtDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// 显示降采样: 超大原图 (如 2775×5551, 解码位图 ~60MB) 直接上屏会在移动端累积爆内存;
// 先 canvas 降到 ≤2048px 再显示, 原 blob 仅留给分享/下载。失败回落原图 URL。
// 显示上限 = 设备像素预算: 屏幕长边 × DPR (下限 2048) —— 再多像素屏幕也显示不出,
// 却要吃数倍内存; 下载/分享始终是全分辨率原图 (故"保存的比显示的清晰"是预期且正确)。
const displayCap = () => Math.max(2048, Math.round(Math.max(screen.width, screen.height) * (window.devicePixelRatio || 1)));
async function downscaleForDisplay(blob: Blob, maxDim = displayCap()): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(blob);
    try {
      if (Math.max(bmp.width, bmp.height) <= maxDim) return null;
      const k = maxDim / Math.max(bmp.width, bmp.height);
      const cw = Math.max(1, Math.round(bmp.width * k));
      const ch = Math.max(1, Math.round(bmp.height * k));
      const canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bmp, 0, 0, cw, ch);
      const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', 0.85));
      return out ? URL.createObjectURL(out) : null;
    } finally { bmp.close?.(); }
  } catch { return null; }
}

// 分享/下载 blob (模块级: 弹窗关闭后的"就绪承接" toast 也能复用)
async function shareBlob(w: Wallpaper, blob: Blob) {
  const name = `${w.comic || 'ciyuan'}_${w.id.slice(0, 8)}.webp`;
  const file = new File([blob], name, { type: 'image/webp' });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: w.comic || w.author || '次元壁纸' });
    toast('保存完成', false, 2000);
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('已开始下载', false, 2000);
  }
}

// APP 同款进度环: 细白圆环 + 白色饼扇区 (无底盘/无百分比文字, 不抢眼)
function PieRing({ pct }: { pct: number }) {
  const r = 22, c = 24;
  const a0 = -Math.PI / 2, a1 = a0 + Math.PI * 2 * Math.min(1, Math.max(0, pct));
  const x0 = c + r * Math.cos(a0), y0 = c + r * Math.sin(a0);
  const x1 = c + r * Math.cos(a1), y1 = c + r * Math.sin(a1);
  const large = pct > 0.5 ? 1 : 0;
  const wedge = pct <= 0 ? '' : pct >= 0.999
    ? `M ${c} ${c} m -${r} 0 a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 -${r * 2} 0 Z`
    : `M ${c} ${c} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
  return (
    <div className="orig-ring" role="progressbar" aria-valuenow={Math.round(pct * 100)}>
      <svg viewBox="0 0 48 48">
        <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,.9)" strokeWidth="1.4" />
        {wedge && <path d={wedge} fill="rgba(255,255,255,.95)" />}
      </svg>
      <span className="sr-pct">{Math.round(pct * 100)}%</span>
    </div>
  );
}

export function ModalView() {
  useV();
  const w = state.modal;
  const [origState, setOrigState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [prog, setProg] = useState<{ loaded: number; total: number } | null>(null);
  const [origUrl, setOrigUrl] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);            // 移动端信息/下载弹层
  const [saveArmed, setSaveArmed] = useState(false);    // 加载中点过保存 → 就绪后脉冲提示
  const [tf, setTf] = useState({ s: 1, x: 0, y: 0 });   // 缩放/平移
  const blobRef = useRef<Blob | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d0: number; s0: number; mx: number; my: number } | null>(null);
  const moved = useRef(false);
  const tapTimer = useRef<number | null>(null);
  const armedRef = useRef(false);

  // 预取 (卡片 pointerdown / 弹窗打开即开始, orig.ts 单一 in-flight): 真实进度 → 小圆盘;
  // 完成后 blob 在手 → 下载一次点击即分享。
  useEffect(() => {
    if (!w) return;
    let cancelled = false;
    setProg(null);
    setSheet(false);
    setSaveArmed(false);
    setTf({ s: 1, x: 0, y: 0 });
    setOrigUrl(null); // 杜绝背景残留上一张
    blobRef.current = null;
    const onProg = (p: { loaded: number; total: number }) => { if (!cancelled) setProg(p); };
    const cached = getCachedOrig(w.id);
    if (cached) {
      blobRef.current = cached;
      setProg({ loaded: cached.size, total: cached.size });
      setOrigState('ready');
      void downscaleForDisplay(cached).then((u) => { if (!cancelled) setOrigUrl(u || URL.createObjectURL(cached)); });
    } else {
      setOrigState('loading');
      ensureOrig(w, onProg).then((blob) => {
        if (cancelled) return;
        blobRef.current = blob;
        setOrigState('ready');
        void downscaleForDisplay(blob).then((u) => { if (!cancelled) setOrigUrl(u || URL.createObjectURL(blob)); });
      }).catch(() => { if (!cancelled) setOrigState('error'); });
    }
    return () => {
      cancelled = true;
      // 加载中点过保存却关闭了弹窗: 加载完成后以带行动的 toast 承接 (点击=新手势, 合法拉起分享)
      if (armedRef.current && !getCachedOrig(w.id)) {
        // 加载中点过保存却关了弹窗: 加载完成直接尝试拉起分享 (与弹窗内行为一致);
        // 平台拒绝(手势过期)才降级为带"保存"行动按钮的 toast
        const target = w;
        ensureOrig(target).then((blob) => {
          shareBlob(target, blob).catch((e) => {
            const err = e as Error;
            if (err.name === 'AbortError') return;
            if (err.name === 'NotAllowedError') {
              toast(`${target.comic || target.author || '壁纸'} 原图已就绪`, false, 9000, {
                label: '保存',
                fn: () => { shareBlob(target, blob).catch((e2) => { if ((e2 as Error).name !== 'AbortError') toast('保存失败: ' + (e2 as Error).message, true); }); },
              });
              return;
            }
            toast('保存失败: ' + err.message, true);
          });
        }).catch(() => { /* 失败不叨扰 */ });
      }
      armedRef.current = false;
    };
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

  // ---------- 手势 (仅触屏): 捏合缩放 / 放大后拖动 / 单击弹层 / 横滑切图 / 下滑关闭 ----------
  // PC 端 (pointer:fine) 不启用任何触摸手势: 关闭用 ✕/Esc, 信息常显右栏, 无需切图手势。
  const isTouch = () => window.matchMedia('(pointer: coarse)').matches;
  const start = useRef<{ x: number; y: number } | null>(null);
  const navigate = (dir: 1 | -1) => {
    const list = state.cache.pool.filter(visible);
    const i = list.findIndex((x) => x.id === w?.id);
    const t = i >= 0 ? list[i + dir] : undefined;
    if (t) openModal(t, { replace: true }); // replace: 切图不污染历史栈
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (!isTouch()) return;
    try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* 合成/无效 pointerId: 忽略捕获 */ }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    start.current = { x: e.clientX, y: e.clientY };
    moved.current = false;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d0: Math.hypot(a.x - b.x, a.y - b.y), s0: tf.s, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = pointers.current.get(e.pointerId);
    if (!p) return;    const dx = e.clientX - p.x, dy = e.clientY - p.y;
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
    const st = start.current;
    start.current = null;
    if (pointers.current.size !== 0 || !st) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
      // 单击/双击判别: 260ms 内第二次点按 → 缩放; 否则单击换弹层 (避免连点开-关互相抵消)
      if (tapTimer.current !== null) {
        window.clearTimeout(tapTimer.current);
        tapTimer.current = null;
        setTf((t) => (t.s > 1 ? { s: 1, x: 0, y: 0 } : { s: 2.5, x: 0, y: 0 }));
      } else {
        tapTimer.current = window.setTimeout(() => { tapTimer.current = null; setSheet((s) => !s); }, 260);
      }
      return;
    }
    if (tf.s !== 1) return; // 放大态: 本次是拖动
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) { navigate(dx < 0 ? 1 : -1); return; } // 左滑下一张 / 右滑上一张
    if (dy > 60 && Math.abs(dy) > Math.abs(dx) * 1.4) { // 下滑: 先收弹层, 再关详情
      if (sheet) setSheet(false);
      else closeModal();
    }
  };

  // ---------- 底部弹层: 把手/顶部下拉关闭 (跟手拖拽, 松手判定) ----------
  const sheetRef = useRef<HTMLElement | null>(null);
  const drag = useRef({ y0: 0, dy: 0, on: false });
  const onSheetDown = (e: React.PointerEvent) => {
    if (!isTouch()) return;
    const el = sheetRef.current;
    if (!el) return;
    const onHandle = (e.target as HTMLElement).classList.contains('sheet-handle');
    if (!onHandle && el.scrollTop > 4) return; // 弹层内已滚动时不劫持
    drag.current = { y0: e.clientY, dy: 0, on: true };
    try { el.setPointerCapture?.(e.pointerId); } catch { /* 合成/无效 pointerId */ }
    el.style.transition = 'none';
  };
  const onSheetMove = (e: React.PointerEvent) => {
    if (!drag.current.on || !sheetRef.current) return;
    const dy = Math.max(0, e.clientY - drag.current.y0);
    drag.current.dy = dy;
    sheetRef.current.style.transform = `translateY(${dy}px)`;
  };
  const onSheetUp = () => {
    if (!drag.current.on || !sheetRef.current) return;
    drag.current.on = false;
    const el = sheetRef.current;
    el.style.transition = '';
    el.style.transform = '';
    if (drag.current.dy > 90) setSheet(false);
    drag.current.dy = 0;
  };

  if (!w) return null;
  const pixivNum = w.pixivId && /^\d{1,10}$/.test(String(w.pixivId));
  const pct = prog && prog.total ? Math.min(1, prog.loaded / prog.total) : 0;
  const syncing = origState === 'loading';

  // 下载/保存三态: blob 在手 → 手势内分享; 加载中被点按 → 记住意图, 加载完自动尝试分享,
  // iOS 手势过期(NotAllowed)静默转"点按保存"脉冲态(平台限制, 不弹报错); 用户取消=静默;
  // share() resolve = 保存/分享动作完成 → 成功提示 (Web 端能监听到的最精确信号)。
  const shareOrDownload = (blob: Blob) => shareBlob(w, blob);
  const downloadOrig = async () => {
    let blob = getCachedOrig(w.id) || blobRef.current;
    if (!blob) {
      setSaveArmed(true); armedRef.current = true;
      try { blob = await ensureOrig(w); } catch (e) { setSaveArmed(false); setOrigState('error'); toast('下载失败: ' + (e as Error).message, true); return; }
    }
    try {
      await shareOrDownload(blob);
      setSaveArmed(false); armedRef.current = false;
      setOrigState('ready');
    } catch (e) {
      const err = e as Error;
      if (err.name === 'AbortError') { setSaveArmed(false); armedRef.current = false; return; }
      if (err.name === 'NotAllowedError') { setSaveArmed(true); armedRef.current = false; setOrigState('ready'); return; }
      setSaveArmed(false);
      toast('保存失败: ' + err.message, true);
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
        <div className="modal-figure">
          <img
            key={w.id}
            className={syncing ? 'loading-orig' : ''}
            src={origUrl || thumbOf(w)}
            alt={w.comic || w.author || '壁纸'}
            style={{ transform: `translate(${tf.x}px, ${tf.y}px) scale(${tf.s})` }}
          />
          {syncing && prog && <PieRing pct={prog.total ? Math.min(1, prog.loaded / prog.total) : 0} />}
          {origState === 'error' && (
            <div className="orig-hint"><span className="dot" /><span>原图加载失败（点下载重试）</span></div>
          )}
        </div>
        <button className="modal-close" onClick={closeModal} title="关闭 (Esc)">✕</button>
        {tf.s > 1 && <div className="zoom-hint">{tf.s.toFixed(1)}× · 双击还原 · 单击看信息</div>}
      </div>
      <aside
        ref={sheetRef}
        className={'modal-side' + (sheet ? ' open' : '')}
        onPointerDown={onSheetDown}
        onPointerMove={onSheetMove}
        onPointerUp={onSheetUp}
        onPointerCancel={onSheetUp}
      >
        <div className="sheet-handle" onClick={() => setSheet(false)} />
        <h2>{w.comic || w.author || '壁纸'}</h2>
        <div>
          {rows.map(([k, v]) => (
            <div className="side-row" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>
          ))}
        </div>
        <div className="tag-cloud">
          {w.tags.filter((t) => t.trim()).map((t) => (
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
          <button className={'btn btn-primary' + (saveArmed ? ' armed' : '')} onClick={() => void downloadOrig()}>
            {syncing
              ? <>{saveArmed ? `保存中 ${prog?.total ? Math.round(pct * 100) + '%' : '…'}` : `原图同步 ${prog?.total ? Math.round(pct * 100) + '%' : '…'}`}</>
              : saveArmed
                ? <><svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0 4-4m-4 4-4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 19h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>原图已就绪 · 点按保存</>
                : origState === 'error'
                  ? <><svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 6.3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><path d="M20 5v6h-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>重试下载原图</>
                  : <><svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0 4-4m-4 4-4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 19h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>下载原图</>}
          </button>
          {pixivNum && (
            <a className="btn btn-ghost" href={`https://www.pixiv.net/artworks/${w.pixivId}`} target="_blank" rel="noopener" title="原作可能已被删除或转为私有">Pixiv 来源 ↗</a>
          )}
        </div>
      </aside>
    </div>
  );
}
