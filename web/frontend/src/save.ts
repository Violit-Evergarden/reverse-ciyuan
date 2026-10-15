// 保存意图: 全局单一所有者, 与详情弹窗生命周期解耦。
// 规则: 同一时刻最多一个保存任务; 原图就绪后只调用一次 share();
// 被平台拒绝(手势过期 NotAllowedError)时降级为带"保存"按钮的 toast (点按 = 新手势)。
import { ensureOrig, getCachedOrig } from './orig';
import { bump, state, toast } from './store';
import type { Wallpaper } from './types';

export type SavePhase = 'idle' | 'waiting' | 'armed';

let task: { id: string; seq: number } | null = null;
let seq = 0;

const setPhase = (id: string | null, phase: SavePhase) => {
  state.save = id ? { id, phase } : null;
  bump();
};

const labelOf = (w: Wallpaper) => w.comic || w.author || '壁纸';

async function deliver(w: Wallpaper, blob: Blob) {
  const name = `${w.comic || 'ciyuan'}_${w.id.slice(0, 8)}.webp`;
  const file = new File([blob], name, { type: blob.type || 'image/webp' });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: labelOf(w) });
    toast('保存完成', false, 2000);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('已开始下载', false, 2000);
}

async function attempt(w: Wallpaper, blob: Blob) {
  try {
    await deliver(w, blob);
    setPhase(null, 'idle');
  } catch (e) {
    const err = e as Error;
    if (err.name === 'AbortError') { setPhase(null, 'idle'); return; } // 用户取消分享面板
    if (err.name === 'NotAllowedError') {
      // 手势时效已过: 弹窗开着 → 按钮脉冲; 弹窗关着 → 行动 toast
      setPhase(w.id, 'armed');
      if (state.modal?.id !== w.id) {
        toast(`${labelOf(w)} 原图已就绪`, false, 9000, { label: '保存', fn: () => void requestSave(w) });
      }
      return;
    }
    setPhase(null, 'idle');
    toast('保存失败: ' + err.message, true);
  }
}

// 点"保存"的唯一入口 (按钮/行动 toast 共用)
export async function requestSave(w: Wallpaper) {
  const cached = getCachedOrig(w.id);
  if (cached) { task = null; await attempt(w, cached); return; }
  if (task?.id === w.id) return; // 已在等待同一张, 不重复挂意图
  const my = { id: w.id, seq: ++seq };
  task = my;
  setPhase(w.id, 'waiting');
  try {
    // pin: 关闭弹窗后在首页滑动会触发卡片预取, 未钉住的请求会被 abort —— 这正是
    // "关了弹窗就不拉起保存"的根因。保存意图下的请求必须钉住。
    const blob = await ensureOrig(w, { pin: true });
    if (task !== my) return; // 被更新的保存请求取代
    task = null;
    await attempt(w, blob);
  } catch (e) {
    if (task !== my) return;
    task = null;
    setPhase(null, 'idle');
    toast('下载失败: ' + (e as Error).message, true);
  }
}
