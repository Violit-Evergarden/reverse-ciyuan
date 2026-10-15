import { clearQuery, setScope, searchPool, state, useV, visible } from '../store';

export function FilterBar() {
  useV();
  const pool = searchPool();
  const vis = pool.filter(visible).length;
  const chips: { k: 'scope' | 'query'; label: string; title: string }[] = [];
  if (state.scope) {
    chips.push({
      k: 'scope',
      label: state.scope.type === 'comic' ? `分类「${state.scope.value}」`
        : state.scope.type === 'search' ? `搜索「${state.scope.value}」`
          : `上传者 ${state.scope.value.slice(0, 10)}…`,
      title: '点击取消该过滤',
    });
  }
  if (state.query) chips.push({ k: 'query', label: `过滤「${state.query}」`, title: '点击清除池内过滤' });

  return (
    <div className="filter-bar">
      <div className="fb-title">
        {state.scope
          ? (state.scope.type === 'search' ? `搜索: ${state.scope.value}` : state.scope.value)
          : '最新壁纸'}
      </div>
      <div className="fb-chips">
        {chips.map((c) => (
          <button
            key={c.k}
            className="fb-chip"
            title={c.title}
            onClick={() => {
              if (c.k === 'scope') setScope(null);
              else clearQuery();
            }}
          >{c.label} ✕</button>
        ))}
      </div>
      <span
        className="pill"
        title={vis === pool.length ? '' : '差额为被 R16 开关或过滤条件隐藏的条目'}
      >
        {vis === pool.length
          ? <>已加载 <b>{pool.length}</b></>
          : <>显示 <b>{vis}</b> / 已加载 {pool.length}</>}
      </span>
    </div>
  );
}
