export interface Wallpaper {
  id: string;
  author?: string;
  isR16?: boolean;
  pixivId?: string;
  tags: string[];
  thumbUrl: string;
  url: string;
  width?: number;
  height?: number;
  comic?: string;
  characters: string[];
  uploader?: string;
  createdAt: number;
}
export interface Comic { name: string; count: number; thumbUrl: string }
export interface RankGroup { title: string; wallpapers: Wallpaper[] }
export type Scope = { type: 'comic' | 'uploader' | 'search'; value: string } | null;
export type View = 'home' | 'cats' | 'rank';
