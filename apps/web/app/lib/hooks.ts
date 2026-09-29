"use client";

import { useEffect, useRef, useState } from "react";

export function useDebounced<T>(value: T, delayMs: number, immediate?: (value: T) => boolean): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (immediate?.(value)) {
      setDebounced(value);
      return;
    }
    const handle = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [value, delayMs, immediate]);
  return debounced;
}

export function useLastDefined<T>(value: T | undefined, scope = ""): { value: T | undefined; stale: boolean } {
  const last = useRef<{ scope: string; value: T | undefined }>({ scope, value });
  if (last.current.scope !== scope) last.current = { scope, value: undefined };
  if (value !== undefined) last.current = { scope, value };
  return { value: last.current.value, stale: value === undefined && last.current.value !== undefined };
}

export const isEmptyText = (value: string) => value.trim() === "";
