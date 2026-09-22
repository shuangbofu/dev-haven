'use client';

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';

const minimum = 180;
const maximum = 360;
const initialWidth = 220;
const storageKey = 'devhaven.sidebar';

export function useSidebar() {
  const [width, setWidth] = useState(initialWidth);
  const [collapsed, setCollapsed] = useState(false);
  const [ready, setReady] = useState(false);
  const [windowWidth, setWindowWidth] = useState(1200);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (typeof saved?.width === 'number' && Number.isFinite(saved.width)) setWidth(Math.max(minimum, Math.min(maximum, saved.width)));
      if (typeof saved?.collapsed === 'boolean') setCollapsed(saved.collapsed);
    } catch { /* Invalid or unavailable storage uses the default layout. */ }
    setReady(true);
    const resize = () => setWindowWidth(window.innerWidth);
    resize(); window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(storageKey, JSON.stringify({ width, collapsed })); } catch { /* The layout still works without persistence. */ }
  }, [width, collapsed, ready]);
  const limit = Math.max(minimum, Math.min(maximum, windowWidth - 420));
  const actualWidth = Math.min(width, limit);
  const clamp = (value: number) => Math.max(minimum, Math.min(limit, value));
  const finish = () => { drag.current = null; setDragging(false); };
  return {
    collapsed,
    toggle: () => { finish(); setCollapsed(value => !value); },
    style: { '--sidebar-width': `${collapsed ? 62 : actualWidth}px` } as CSSProperties,
    dragging,
    separator: {
      role: 'separator', tabIndex: 0, 'aria-label': '调整侧栏宽度', 'aria-orientation': 'vertical' as const,
      'aria-valuemin': minimum, 'aria-valuemax': limit, 'aria-valuenow': actualWidth,
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.preventDefault(); event.currentTarget.focus();
        drag.current = { x: event.clientX, width: actualWidth }; setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event: PointerEvent<HTMLDivElement>) => { if (drag.current) setWidth(clamp(drag.current.width + event.clientX - drag.current.x)); },
      onPointerUp: finish, onPointerCancel: finish, onLostPointerCapture: finish,
      onDoubleClick: () => setWidth(clamp(initialWidth)),
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); setWidth(event.key === 'Home' ? minimum : event.key === 'End' ? limit : clamp(actualWidth + (event.key === 'ArrowLeft' ? -10 : 10)));
      },
    },
  };
}
