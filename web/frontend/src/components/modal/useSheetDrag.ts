// 移动端底部弹层: 把手/顶部下拉跟手拖拽, 松手 dy>90 关闭, 否则回弹。
// 弹层内容已滚动时不劫持 (让用户正常滚动内容)。
import { useRef } from 'react';

const isTouch = () => window.matchMedia('(pointer: coarse)').matches;

export function useSheetDrag(onClose: () => void) {
  const ref = useRef<HTMLElement | null>(null);
  const drag = useRef({ y0: 0, dy: 0, on: false });

  const end = () => {
    const el = ref.current;
    if (!drag.current.on || !el) return;
    drag.current.on = false;
    el.style.transition = '';
    el.style.transform = '';
    if (drag.current.dy > 90) onClose();
    drag.current.dy = 0;
  };

  return {
    ref,
    bind: {
      onPointerDown: (e: React.PointerEvent) => {
        const el = ref.current;
        if (!isTouch() || !el) return;
        const onHandle = (e.target as HTMLElement).classList.contains('sheet-handle');
        if (!onHandle && el.scrollTop > 4) return;
        drag.current = { y0: e.clientY, dy: 0, on: true };
        try { el.setPointerCapture(e.pointerId); } catch { /* 无效 pointerId */ }
        el.style.transition = 'none';
      },
      onPointerMove: (e: React.PointerEvent) => {
        const el = ref.current;
        if (!drag.current.on || !el) return;
        drag.current.dy = Math.max(0, e.clientY - drag.current.y0);
        el.style.transform = `translateY(${drag.current.dy}px)`;
      },
      onPointerUp: end,
      onPointerCancel: end,
    },
  };
}
