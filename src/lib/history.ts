import { useCallback, useRef, useState } from 'react';

/**
 * Состояние с историей отмены.
 * set(next) записывает шаг. Во время перетаскивания вызывается checkpoint()
 * один раз в начале, а затем set(next, false) на каждое движение - так всё
 * перетаскивание отменяется одним Ctrl+Z.
 */
export function useHistory<T>(initial: T | (() => T), limit = 80) {
  const [present, setPresent] = useState<T>(initial);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const presentRef = useRef(present);
  presentRef.current = present;
  const [, force] = useState(0);

  const set = useCallback(
    (next: T | ((prev: T) => T), record = true) => {
      const value = typeof next === 'function' ? (next as (p: T) => T)(presentRef.current) : next;
      if (record) {
        past.current.push(presentRef.current);
        if (past.current.length > limit) past.current.shift();
        future.current = [];
      }
      presentRef.current = value;
      setPresent(value);
    },
    [limit],
  );

  const checkpoint = useCallback(() => {
    past.current.push(presentRef.current);
    if (past.current.length > limit) past.current.shift();
    future.current = [];
    force((n) => n + 1);
  }, [limit]);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (prev === undefined) return;
    future.current.push(presentRef.current);
    presentRef.current = prev;
    setPresent(prev);
  }, []);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (next === undefined) return;
    past.current.push(presentRef.current);
    presentRef.current = next;
    setPresent(next);
  }, []);

  return {
    present,
    set,
    checkpoint,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}
