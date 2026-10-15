// 详情舞台触屏手势 (仅 pointer:coarse): 捏合缩放 / 放大后拖动 / 单击·双击 / 横滑切图 / 下滑关闭。
// PC 端不挂任何手势: 关闭用 ✕/Esc, 信息常显右栏。
import { useRef, useState } from 'react';

export interface Transform { s: number; x: number; y: number }
const IDENTITY: Transform = { s: 1, x: 0, y: 0 };
const isTouch = () => window.matchMedia('(pointer: coarse)').matches;

interface Handlers {
  onTap: () => void;            // 单击 (已排除双击)
  onSwipe: (dir: 1 | -1) => void; // 左滑=+1 下一张, 右滑=-1 上一张
  onSwipeDown: () => void;
}

export function useStageGestures({ onTap, onSwipe, onSwipeDown }: Handlers) {
  const [tf, setTf] = useState<Transform>(IDENTITY);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d0: number; s0: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const tapTimer = useRef<number | null>(null);

  const reset = () => {
    setTf(IDENTITY);
    if (tapTimer.current !== null) { window.clearTimeout(tapTimer.current); tapTimer.current = null; }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!isTouch()) return;
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* 无效 pointerId */ }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) start.current = { x: e.clientX, y: e.clientY };
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d0: Math.hypot(a.x - b.x, a.y - b.y), s0: tf.s };
      start.current = null; // 两指操作不再参与单击/滑动判定
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const s = Math.min(4, Math.max(1, pinch.current.s0 * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.d0)));
      setTf((t) => (s === 1 ? IDENTITY : { ...t, s }));
    } else if (pointers.current.size === 1 && tf.s > 1) {
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      setTf((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const st = start.current;
    if (pointers.current.size !== 0 || !st) return;
    start.current = null;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
      if (tapTimer.current !== null) { // 双击: 切缩放
        window.clearTimeout(tapTimer.current);
        tapTimer.current = null;
        setTf((t) => (t.s > 1 ? IDENTITY : { s: 2.5, x: 0, y: 0 }));
      } else {
        tapTimer.current = window.setTimeout(() => { tapTimer.current = null; onTap(); }, 260);
      }
      return;
    }
    if (tf.s !== 1) return; // 放大态下是拖动
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) onSwipe(dx < 0 ? 1 : -1);
    else if (dy > 60 && Math.abs(dy) > Math.abs(dx) * 1.4) onSwipeDown();
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    pinch.current = null;
    start.current = null;
  };

  return { tf, reset, bind: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel } };
}
