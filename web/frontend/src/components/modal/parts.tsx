// 详情弹窗的纯展示组件: 图标 / 进度环 / 信息区 / 画质切换
import type { ReactNode } from 'react';
import type { Wallpaper } from '../../types';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export function IconDownload() {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v11m0 0 4-4m-4 4-4-4" {...S} />
      <path d="M5 19h14" {...S} />
    </svg>
  );
}

export function IconRetry() {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 11a8 8 0 1 0-2.3 6.3" {...S} />
      <path d="M20 5v6h-6" {...S} />
    </svg>
  );
}

/** APP 同款进度环: 细白圆环 + 白色饼扇区, 无底盘 */
export function PieRing({ pct }: { pct: number }) {
  const r = 22, c = 24;
  const p = Math.min(1, Math.max(0, pct));
  const a0 = -Math.PI / 2, a1 = a0 + Math.PI * 2 * p;
  const wedge = p <= 0 ? null
    : p >= 0.999
      ? <circle cx={c} cy={c} r={r} fill="rgba(255,255,255,.95)" />
      : <path
          d={`M ${c} ${c} L ${c + r * Math.cos(a0)} ${c + r * Math.sin(a0)} A ${r} ${r} 0 ${p > 0.5 ? 1 : 0} 1 ${c + r * Math.cos(a1)} ${c + r * Math.sin(a1)} Z`}
          fill="rgba(255,255,255,.95)"
        />;
  return (
    <div className="orig-ring" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)}>
      <svg viewBox="0 0 48 48">
        <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,.9)" strokeWidth="1.4" />
        {wedge}
      </svg>
    </div>
  );
}

/** 画质分段控件: 适配屏幕 / 原图 (仅移动端且原图超出屏幕预算时出现) */
export function QualitySwitch({ value, onChange }: { value: 'fit' | 'full'; onChange: (v: 'fit' | 'full') => void }) {
  return (
    <div className="seg" role="radiogroup" aria-label="显示画质">
      {(['fit', 'full'] as const).map((v) => (
        <button
          key={v}
          role="radio"
          aria-checked={value === v}
          className={'seg-item' + (value === v ? ' on' : '')}
          onClick={() => onChange(v)}
        >{v === 'fit' ? '适配屏幕' : '原图'}</button>
      ))}
    </div>
  );
}

export interface InfoRow { k: string; v: ReactNode }

const fmtDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** 只输出有值的行: 空字段不渲染 (不再显示一排"—") */
export function buildRows(w: Wallpaper, link: { comic: () => void; uploader: () => void }): InfoRow[] {
  const rows: InfoRow[] = [];
  rows.push({ k: '作者', v: w.author || '匿名' });
  if (w.comic) rows.push({ k: '分类', v: <button className="linklike" onClick={link.comic}>「{w.comic}」全部</button> });
  if (w.width && w.height) rows.push({ k: '尺寸', v: `${w.width} × ${w.height}` });
  if (w.pixivId) {
    rows.push({
      k: 'Pixiv ID',
      v: /^\d{1,10}$/.test(String(w.pixivId))
        ? <a href={`https://www.pixiv.net/artworks/${w.pixivId}`} target="_blank" rel="noopener" title="原作可能已被删除或转为私有">{w.pixivId} ↗</a>
        : <span className="mono" title="非 pixiv 作品 ID(站外源标识)">{w.pixivId}</span>,
    });
  }
  rows.push({ k: '上传日期', v: fmtDate(w.createdAt) });
  if (w.characters.length) rows.push({ k: '角色', v: w.characters.join('、') });
  if (w.uploader) rows.push({ k: '上传者', v: <button className="linklike" title="查看该上传者的全部转载" onClick={link.uploader}>{w.uploader.slice(0, 10)}…</button> });
  return rows;
}
