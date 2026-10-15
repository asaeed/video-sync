import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, RefObject } from "react";

const HANDLE = 10;
const PREFIX = "video-sync-studio-panel-v1:";
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function useStoredSize(name: string, fallback: number): [number, (value: number) => void] {
  const [value, setValue] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(PREFIX + name));
      return Number.isFinite(stored) && stored > 0 ? stored : fallback;
    } catch {
      return fallback;
    }
  });
  const update = (next: number) => {
    setValue(next);
    try { localStorage.setItem(PREFIX + name, String(Math.round(next))); } catch { /* Storage is optional. */ }
  };
  return [value, update];
}

function useMeasuredPanel(): { ref: RefObject<HTMLDivElement | null>; width: number; height: number } {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const computed = getComputedStyle(node);
      setSize({
        width: node.clientWidth - parseFloat(computed.paddingLeft) - parseFloat(computed.paddingRight),
        height: node.clientHeight - parseFloat(computed.paddingTop) - parseFloat(computed.paddingBottom),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, ...size };
}

export function useThreePanelLayout() {
  const { ref, width } = useMeasuredPanel();
  const [left, setLeft] = useStoredSize("left", 220);
  const [right, setRight] = useStoredSize("right", 270);
  const available = Math.max(0, (width || 1100) - 2 * HANDLE);
  const minLeft = Math.min(150, available * 0.23);
  const minRight = Math.min(210, available * 0.32);
  const minMiddle = Math.max(0, Math.min(320, available - minLeft - minRight));
  const leftWidth = clamp(left, minLeft, available - minRight - minMiddle);
  const rightWidth = clamp(right, minRight, available - leftWidth - minMiddle);
  const style: CSSProperties = { gridTemplateColumns: `${leftWidth}px ${HANDLE}px minmax(0, 1fr) ${HANDLE}px ${rightWidth}px` };
  return {
    ref, style, leftWidth, rightWidth,
    setLeft: (value: number) => setLeft(clamp(value, minLeft, available - rightWidth - minMiddle)),
    setRight: (value: number) => setRight(clamp(value, minRight, available - leftWidth - minMiddle)),
  };
}

export function useBottomPanelLayout(kind: "sources" | "loops") {
  const { ref, height } = useMeasuredPanel();
  const isLoops = kind === "loops";
  const [bottom, setBottom] = useStoredSize(`${kind}-bottom`, isLoops ? 250 : 200);
  const minBottom = isLoops ? 160 : 175;
  const reserved = isLoops ? 64 + 45 + HANDLE + 245 : 64 + HANDLE + 180;
  const maxBottom = Math.max(minBottom, (height || 800) - reserved);
  const bottomHeight = clamp(bottom, minBottom, maxBottom);
  const style: CSSProperties = {
    gridTemplateRows: isLoops
      ? `auto minmax(245px, 1fr) ${HANDLE}px ${bottomHeight}px auto`
      : `auto minmax(180px, 1fr) ${HANDLE}px ${bottomHeight}px`,
  };
  return { ref, style, bottomHeight, setBottom: (value: number) => setBottom(clamp(value, minBottom, maxBottom)) };
}

export function PanelResizeHandle({ name, axis, value, direction = 1, onChange }: {
  name: string;
  axis: "x" | "y";
  value: number;
  direction?: 1 | -1;
  onChange: (value: number) => void;
}) {
  const drag = useRef<{ pointerId: number; origin: number; value: number; cursor: string; userSelect: string } | null>(null);
  const position = (event: ReactPointerEvent) => axis === "x" ? event.clientX : event.clientY;
  const finish = () => {
    if (!drag.current) return;
    document.body.style.cursor = drag.current.cursor;
    document.body.style.userSelect = drag.current.userSelect;
    drag.current = null;
  };
  useEffect(() => () => finish(), []);
  const end = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    finish();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <div
    className={`panel-resizer ${axis === "x" ? "column-resizer" : "row-resizer"}`}
    role="separator"
    tabIndex={0}
    aria-label={name}
    aria-orientation={axis === "x" ? "vertical" : "horizontal"}
    aria-valuenow={Math.round(value)}
    title={`${name} · drag or use arrow keys`}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      drag.current = { pointerId: event.pointerId, origin: position(event), value, cursor: document.body.style.cursor, userSelect: document.body.style.userSelect };
      document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={(event) => {
      if (drag.current?.pointerId !== event.pointerId) return;
      onChange(drag.current.value + (position(event) - drag.current.origin) * direction);
    }}
    onPointerUp={end}
    onPointerCancel={end}
    onLostPointerCapture={finish}
    onKeyDown={(event) => {
      const step = event.shiftKey ? 50 : 20;
      const delta = axis === "x" ? event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0
        : event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
      if (!delta) return;
      event.preventDefault();
      event.stopPropagation();
      onChange(value + delta * direction);
    }}
  />;
}
