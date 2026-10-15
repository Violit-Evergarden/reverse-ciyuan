import { dismissToast, state, useV } from '../store';

export function Toasts() {
  useV();
  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      {state.toasts.map((t) => (
        <div key={t.id} className={'toast' + (t.err ? ' err' : '') + (t.sticky ? ' sticky' : '')}>
          <span>{t.msg}</span>
          {t.action && (
            <button
              className="toast-act"
              onClick={() => { dismissToast(t.id); t.action?.fn(); }}
            >{t.action.label}</button>
          )}
          {t.sticky && (
            <button className="toast-x" aria-label="关闭提示" onClick={() => dismissToast(t.id)}>✕</button>
          )}
        </div>
      ))}
    </div>
  );
}
