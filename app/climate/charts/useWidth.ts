'use client';

/**
 * The width of a chart's box, kept current.
 *
 * Bklit's charts measure their parent (visx's ParentSize); this is the same
 * idea in a dozen lines. The box's HEIGHT is fixed in CSS by the caller, so
 * the space is reserved before the first measurement lands and nothing below
 * the chart moves when it draws.
 */

import { useLayoutEffect, useRef, useState } from 'react';

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    setWidth(Math.floor(node.getBoundingClientRect().width));
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}
