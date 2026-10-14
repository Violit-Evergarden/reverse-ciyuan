import type { Wallpaper } from './types';

// 瀑布流参数: 与 APP 手机端 2 列对齐 (≤900px), 桌面按 280px 理想列宽取 2–5 列
export const MAS = { ideal: 280, gapDesk: 14, gapMobile: 10, maxCols: 5 };
export function masonrySpec(width: number, innerWidth: number) {
  if (innerWidth <= 900) return { n: 2, gap: MAS.gapMobile };
  const n = Math.max(2, Math.min(MAS.maxCols, Math.floor((width + MAS.gapDesk) / (MAS.ideal + MAS.gapDesk))));
  return { n, gap: MAS.gapDesk };
}
export const cardH = (w: Wallpaper, colW: number, gap: number) =>
  colW * ((w.width && w.height) ? (w.height / w.width) : 1.414) + gap;

// 贪心最短列: 在线算法 → 前缀稳定 (追加新卡不移动旧卡), 与 APP StaggeredGrid 同语义;
// 因此可对全量 visible 列表声明式重算而保持 append 稳定。
export function distribute<T>(items: T[], h: (t: T) => number, n: number, gap: number): T[][] {
  const cols: T[][] = Array.from({ length: n }, () => []);
  const hs = new Array<number>(n).fill(0);
  for (const it of items) {
    let b = 0;
    for (let i = 1; i < n; i++) if (hs[i] < hs[b]) b = i;
    cols[b].push(it);
    hs[b] += h(it) + gap;
  }
  return cols;
}
