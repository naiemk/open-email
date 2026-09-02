import { useCallback, useRef, useState } from "react";

/** Run async actions; each key can run independently (send vs reload). */
export function usePendingAction() {
  const activeKeys = useRef<Set<string>>(new Set());
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());

  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    if (activeKeys.current.has(key)) return undefined;
    activeKeys.current.add(key);
    setPendingKeys((prev) => new Set(prev).add(key));
    try {
      return await fn();
    } finally {
      activeKeys.current.delete(key);
      setPendingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, []);

  const isPending = useCallback(
    (key?: string) => (key ? pendingKeys.has(key) : pendingKeys.size > 0),
    [pendingKeys],
  );

  return { pending: pendingKeys.size > 0 ? [...pendingKeys][0] : null, run, isPending };
}
