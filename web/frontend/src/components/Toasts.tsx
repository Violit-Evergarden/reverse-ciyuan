import { state, useV } from '../store';

export function Toasts() {
  useV();
  return (
    <div className="toast-wrap">
      {state.toasts.map((t) => (
        <div key={t.id} className={'toast' + (t.err ? ' err' : '')}>{t.msg}</div>
      ))}
    </div>
  );
}
