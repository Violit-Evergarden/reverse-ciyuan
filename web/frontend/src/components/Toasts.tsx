import { bump, state, useV } from '../store';

export function Toasts() {
  useV();
  return (
    <div className="toast-wrap">
      {state.toasts.map((t) => (
        <div key={t.id} className={'toast' + (t.err ? ' err' : '')}>
          <span>{t.msg}</span>
          {t.action && (
            <button
              className="toast-act"
              onClick={() => { t.action?.fn(); state.toasts = state.toasts.filter((x) => x.id !== t.id); bump(); }}
            >{t.action.label}</button>
          )}
        </div>
      ))}
    </div>
  );
}
