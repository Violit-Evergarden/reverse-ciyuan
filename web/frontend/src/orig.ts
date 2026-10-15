// 原图 (XOR 解码流) 加载与缓存。
// - LRU 字节上限缓存: 重进详情零网络零等待
// - 按 id 的 in-flight 表: 同一张图只发一次请求
// - 进度为订阅制: 谁订阅谁收, 不会串到别的图
// - 预取只保留"最新的一张"(其余未被钉住的预取会被 abort); 有保存意图的请求被钉住, 永不被预取挤掉
import { origOf } from './api';
import type { Wallpaper } from './types';

export interface Prog { loaded: number; total: number }
type Listener = (p: Prog) => void;

const MAX_BYTES = 384 * 1024 * 1024;
const lru = new Map<string, Blob>();
let lruBytes = 0;
function lruPut(id: string, blob: Blob) {
  const old = lru.get(id);
  if (old) lruBytes -= old.size;
  lru.delete(id);
  lru.set(id, blob);
  lruBytes += blob.size;
  for (const [k, v] of lru) { // Map 迭代序 = 插入序: 从最旧淘汰
    if (lruBytes <= MAX_BYTES) break;
    lru.delete(k);
    lruBytes -= v.size;
  }
}
export const getCachedOrig = (id: string) => lru.get(id) || null;

interface Job { p: Promise<Blob>; abort: AbortController; listeners: Set<Listener>; last: Prog | null; pinned: boolean }
const jobs = new Map<string, Job>();

function start(w: Wallpaper): Job {
  const abort = new AbortController();
  const job: Job = { p: null as unknown as Promise<Blob>, abort, listeners: new Set(), last: null, pinned: false };
  const emit = (p: Prog) => { job.last = p; job.listeners.forEach((l) => l(p)); };
  job.p = (async () => {
    const r = await fetch(origOf(w), { signal: abort.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const total = Number(r.headers.get('content-length') || 0);
    const type = r.headers.get('content-type') || 'image/webp';
    const reader = r.body?.getReader();
    let blob: Blob;
    if (!reader) {
      blob = await r.blob();
    } else {
      const chunks: Uint8Array[] = [];
      let loaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        emit({ loaded, total });
      }
      blob = new Blob(chunks as BlobPart[], { type });
    }
    lruPut(w.id, blob);
    emit({ loaded: blob.size, total: blob.size });
    return blob;
  })();
  job.p.catch(() => { /* 由调用方处理 */ }).finally(() => { if (jobs.get(w.id) === job) jobs.delete(w.id); });
  jobs.set(w.id, job);
  return job;
}

/** 获取原图 blob (缓存 → 在途 → 新请求)。prefetch=true 时会让出其它未钉住的预取。 */
export function ensureOrig(w: Wallpaper, opts: { prefetch?: boolean; pin?: boolean } = {}): Promise<Blob> {
  const c = getCachedOrig(w.id);
  if (c) return Promise.resolve(c);
  if (opts.prefetch) {
    for (const [id, j] of jobs) if (id !== w.id && !j.pinned) j.abort.abort();
  }
  const job = jobs.get(w.id) || start(w);
  if (opts.pin) job.pinned = true;
  return job.p;
}

/** 订阅某张图的加载进度; 返回取消订阅函数。已缓存时立即回调 100%。 */
export function watchProgress(id: string, fn: Listener): () => void {
  const c = getCachedOrig(id);
  if (c) { fn({ loaded: c.size, total: c.size }); return () => {}; }
  const job = jobs.get(id);
  if (!job) return () => {};
  job.listeners.add(fn);
  if (job.last) fn(job.last);
  return () => { job.listeners.delete(fn); };
}
