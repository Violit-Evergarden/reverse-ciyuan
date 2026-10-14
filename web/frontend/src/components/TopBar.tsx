import { useEffect, useRef } from 'react';
import { onSearch, state, toggleR16, useV } from '../store';

const VIEWS: { key: 'home' | 'cats' | 'rank'; label: string }[] = [
  { key: 'home', label: '首页' },
  { key: 'cats', label: '分类' },
  { key: 'rank', label: '排行' },
];

export function TopBar() {
  useV();
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <header className="topbar">
      <div className="brand"><span className="logo">次元壁纸</span></div>
      <nav className="nav">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            className={state.view === v.key ? 'active' : ''}
            onClick={() => { location.hash = '#/' + v.key; }}
          >{v.label}</button>
        ))}
      </nav>
      <div className="spacer" />
      <div className={'searchbox' + (inputRef.current?.value ? ' has-value' : '')}>
        <input
          ref={inputRef}
          type="search"
          placeholder="搜索 标签 / 作者 / 作品…"
          autoComplete="off"
          onInput={(e) => {
            const v = (e.target as HTMLInputElement).value;
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => onSearch(v), 220);
          }}
        />
        <button
          className="clear"
          title="清除"
          onClick={() => { if (inputRef.current) inputRef.current.value = ''; onSearch(''); }}
        >✕</button>
      </div>
      <label className="toggle-r16" title="隐藏 R16 内容">
        <input
          type="checkbox"
          checked={state.hideR16}
          onChange={(e) => toggleR16(e.target.checked)}
        />
        <span className="label">隐藏 R16</span>
      </label>
    </header>
  );
}
