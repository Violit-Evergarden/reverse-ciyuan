import type { Comic, RankGroup, Wallpaper } from './types';

export class ApiError extends Error {
  code: number;
  constructor(code: number, msg: string) { super(msg); this.code = code; }
}

async function api<T>(path: string): Promise<T> {
  const r = await fetch(path);
  const j = await r.json();
  if (j.code !== 0) throw new ApiError(j.code, j.msg || `API 错误 (${j.code})`);
  return j as T;
}

export interface PageResp { wallpapers: Wallpaper[]; nextCursor: string | null; count: number }

export const apiWallpapers = (cursor: string | null, comic: string | null) =>
  api<PageResp>(`/api/wallpapers?${new URLSearchParams({ ...(cursor ? { cursor } : {}), ...(comic ? { comic } : {}) })}`);
export const apiSearch = (keyword: string, cursor: string | null) =>
  api<PageResp>(`/api/search?${new URLSearchParams({ keyword, ...(cursor ? { cursor } : {}) })}`);
export const apiRank = () => api<{ data: { items: RankGroup[] } }>('/api/rank');
export const apiComics = () => api<{ comics: Comic[] }>('/api/comics');
export const apiStatus = () => api<{ hasToken: boolean; hasAccount: boolean }>('/api/status');

export const thumbOf = (w: { thumbUrl: string }) => `/api/img/thumb?u=${encodeURIComponent(w.thumbUrl)}`;
export const origOf = (w: { url: string }) => `/api/img/orig?u=${encodeURIComponent(w.url)}`;
