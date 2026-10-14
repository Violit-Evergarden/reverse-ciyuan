// 原图 (XOR 解码流) 预取与缓存: 卡片 pointerdown / 弹窗打开即开始, 下载按钮复用同一 in-flight
// promise (不重复请求); 流式读取 content-length 上报进度 (圆环用)。
import { origOf } from './api';
import type { Wallpaper } from './types';

export interface Prog { loaded: number; total: number }
let blobCache: { id: string; blob: Blob } | null = null;
let inflight: { id: string; p: Promise<Blob> } | null = null;
let progCb: ((p: Prog) => void) | null = null;
export const setOrigProgCb = (cb: ((p: Prog) => void) | null) => { progCb = cb; };
export const getCachedOrig = (id: string) => (blobCache?.id === id ? blobCache.blob : null);

export function ensureOrig(w: Wallpaper): Promise<Blob> {
  const c = getCachedOrig(w.id);
  if (c) return Promise.resolve(c);
  if (inflight?.id === w.id) return inflight.p;
  const p = (async () => {
    const r = await fetch(origOf(w));
    if (!r.ok) throw new Error(String(r.status));
    const total = Number(r.headers.get('content-length') || 0);
    const reader = r.body?.getReader();
    if (!reader) {
      const b = await r.blob();
      blobCache = { id: w.id, blob: b };
      progCb?.({ loaded: b.size, total: b.size });
      return b;
    }
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) { chunks.push(value); loaded += value.length; progCb?.({ loaded, total }); }
    }
    const blob = new Blob(chunks as BlobPart[], { type: 'image/webp' });
    blobCache = { id: w.id, blob };
    progCb?.({ loaded: blob.size, total: blob.size });
    return blob;
  })();
  inflight = { id: w.id, p };
  p.catch(() => { /* 下载/预览时再报 */ }).finally(() => { if (inflight?.id === w.id) inflight = null; });
  return p;
}
