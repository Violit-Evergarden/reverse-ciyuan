// 保存意图: 全局单一所有者, 与详情弹窗生命周期解耦。
//
// iOS 平台规则 (决定一切行为的前提): navigator.share 只能在"用户刚触摸过"的短窗口内调用。
//  - 原图在窗口内就绪 → 直接拉起分享面板 (一次点击完成)
//  - 原图就绪时窗口已过 (冷加载慢 / 期间没有新的触摸) → share 抛 NotAllowedError
//    此时任何代码都无法再自动拉起面板, 只能请用户再点一次: 用**常驻**行动 toast 承接,
//    点击 = 新手势, 必然成功。弹窗开着时按钮同时进入脉冲态。
import { ensureOrig, getCachedOrig } from './orig';
import { bump, dismissToastKey, state, toast } from './store';
import type { Wallpaper } from './types';

export type SavePhase = 'idle' | 'waiting' | 'armed';

let task: { id: string } | null = null;
const toastKey = (id: string) => `save:${id}`;
const labelOf = (w: Wallpaper) => w.comic || w.author || '壁纸';

function setPhase(id: string | null, phase: SavePhase) {
  state.save = id ? { id, phase } : null;
  bump();
}

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
  dismissToastKey(toastKey(w.id));
  try {
    await deliver(w, blob);
    setPhase(null, 'idle');
  } catch (e) {
    const err = e as Error;
    if (err.name === 'AbortError') { setPhase(null, 'idle'); return; }
    if (err.name === 'NotAllowedError') {
      setPhase(w.id, 'armed');
      // 常驻 (ms=0): 不会在用户没看到时自动消失
      toast(`${labelOf(w)} · 原图已就绪`, false, 0, { label: '保存', fn: () => void requestSave(w) }, toastKey(w.id));
      return;
    }
    setPhase(null, 'idle');
    toast('保存失败: ' + err.message, true);
  }
}

/** 保存的唯一入口 (详情按钮 / 承接 toast 共用) */
export async function requestSave(w: Wallpaper) {
  const cached = getCachedOrig(w.id);
  if (cached) { if (task?.id === w.id) task = null; await attempt(w, cached); return; }
  if (task?.id === w.id) return; // 同一张已在等待
  const my = { id: w.id };
  task = my;
  setPhase(w.id, 'waiting');
  try {
    // pin: 保存意图下的请求不被首页卡片预取 abort
    const blob = await ensureOrig(w, { pin: true });
    if (task !== my) return;
    task = null;
    await attempt(w, blob);
  } catch (e) {
    if (task !== my) return;
    task = null;
    setPhase(null, 'idle');
    toast('下载失败: ' + (e as Error).message, true);
  }
}

/** 用户重新打开该图详情时: 承接 toast 让位给详情内的脉冲按钮 */
export function onModalOpened(id: string) {
  if (state.save?.id === id && state.save.phase === 'armed') dismissToastKey(toastKey(id));
}
