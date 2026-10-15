// 详情页原图: 加载状态 / 进度 / 显示用 URL (按画质策略降采样)。
// 原 blob 由 orig.ts 的 LRU 持有, 这里只管"显示"; 保存走 save.ts, 与本 hook 无关。
import { useEffect, useState } from 'react';
import { ensureOrig, getCachedOrig, watchProgress, type Prog } from '../../orig';
import type { Wallpaper } from '../../types';

export type OrigState = 'loading' | 'ready' | 'error';
export type Quality = 'fit' | 'full';

// 画质策略: 桌面默认全分辨率; 移动端默认"设备像素预算"(屏幕长边×DPR, 下限 2048),
// 防止 4724×8266 这类大图 (~156MB 位图) 在 iPhone 上爆内存; 用户可切"原图"。
export const isDesktop = () => window.matchMedia('(pointer: fine)').matches;
const FULL_CAP = 12288;
const deviceBudget = () =>
  Math.max(2048, Math.round(Math.max(screen.width, screen.height) * (window.devicePixelRatio || 1)));
const capOf = (q: Quality) => (q === 'full' || isDesktop() ? FULL_CAP : deviceBudget());

/** 超出上限才降采样; 返回 null 表示直接用原 blob。 */
async function toDisplayBlob(blob: Blob, maxDim: number): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(blob);
    try {
      const long = Math.max(bmp.width, bmp.height);
      if (long <= maxDim) return null;
      const k = maxDim / long;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bmp.width * k));
      canvas.height = Math.max(1, Math.round(bmp.height * k));
      canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      return await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', 0.9));
    } finally { bmp.close?.(); }
  } catch { return null; }
}

/** 原图是否超过移动端显示预算 (决定是否需要提供"原图"切换) */
export function exceedsBudget(w: Wallpaper) {
  return !isDesktop() && Math.max(w.width || 0, w.height || 0) > deviceBudget();
}

export function useOriginal(w: Wallpaper | null, quality: Quality) {
  const [state, setState] = useState<OrigState>('loading');
  const [prog, setProg] = useState<Prog | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0); // 失败后重试: 递增即重新执行加载 effect

  // 1) 加载原 blob + 订阅进度 (仅依赖图片 id)
  useEffect(() => {
    if (!w) return;
    let alive = true;
    const cached = getCachedOrig(w.id);
    setBlob(cached);
    setState(cached ? 'ready' : 'loading');
    setProg(null);
    if (cached) return;
    const p = ensureOrig(w);
    const unwatch = watchProgress(w.id, (pr) => { if (alive) setProg(pr); });
    p.then((b) => { if (alive) { setBlob(b); setState('ready'); } })
      .catch(() => { if (alive) setState('error'); });
    return () => { alive = false; unwatch(); };
  }, [w?.id, nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // 2) 由 blob + 画质生成显示 URL; 切换/卸载时回收
  useEffect(() => {
    if (!blob) { setUrl(null); return; }
    let alive = true;
    let made: string | null = null;
    void toDisplayBlob(blob, capOf(quality)).then((d) => {
      if (!alive) return;
      made = URL.createObjectURL(d || blob);
      setUrl(made);
    });
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [blob, quality]);

  const pct = prog && prog.total ? Math.min(1, prog.loaded / prog.total) : 0;
  return { state, pct, hasProgress: !!prog, url, retry: () => setNonce((n) => n + 1) };
}
