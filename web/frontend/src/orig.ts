// 原图 (XOR 解码流) 预取与缓存: 卡片 pointerdown / 弹窗打开即开始; 单一 in-flight,
// 切换目标时 abort 旧请求; 进度回调按请求绑定 (避免上一张的进度打进新弹窗)。
import { origOf } from './api';
import type { Wallpaper } from './types';

export interface Prog { loaded: number; total: number }
let blobCache: { id: string; blob: Blob } | null = null;
let inflight: { id: string; p: Promise<Blob>; abort: AbortController; cb: ((p: Prog) => void) | null } | null = null;

export const getCachedOrig = (id: string) => (blobCache?.id === id ? blobCache.blob : null);

export function ensureOrig(w: Wallpaper, onProg?: (p: Prog) => void): Promise<Blob> {
  const c = getCachedOrig(w.id);
  if (c) {
    onProg?.({ loaded: c.size, total: c.size });
    return Promise.resolve(c);
  }
  if (inflight?.id === w.id) {
    if (onProg) inflight.cb = onProg;
    return inflight.p;
  }
  if (inflight && inflight.id !== w.id) inflight.abort.abort(); // 单飞: 新目标取代旧请求
  const abort = new AbortController();
  const slot = { id: w.id, cb: onProg || null, abort, p: null as unknown as Promise<Blob> };
  slot.p = (async () => {
    const r = await fetch(origOf(w), { signal: abort.signal });
    if (!r.ok) throw new Error(String(r.status));
    const total = Number(r.headers.get('content-length') || 0);
    const reader = r.body?.getReader();
    if (!reader) {
      const b = await r.blob();
      blobCache = { id: w.id, blob: b };
      slot.cb?.({ loaded: b.size, total: b.size });
      return b;
    }
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) { chunks.push(value); loaded += value.length; slot.cb?.({ loaded, total }); }
    }
    const blob = new Blob(chunks as BlobPart[], { type: 'image/webp' });
    blobCache = { id: w.id, blob };
    slot.cb?.({ loaded: blob.size, total: blob.size });
    return blob;
  })();
  slot.p.catch(() => { /* 调用方各自处理 */ }).finally(() => { if (inflight === slot) inflight = null; });
  inflight = slot;
  return slot.p;
}
