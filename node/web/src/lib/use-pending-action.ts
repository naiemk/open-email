import { useCallback, useRef, useState } from "react";

/** Run one async action at a time; expose pending key for button disabled states. */
export function usePendingAction() {
  const busyRef = useRef(false);
  const [pending, setPending] = useState<string | null>(null);

  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    if (busyRef.current) return undefined;
    busyRef.current = true;
    setPending(key);
    try {
      return await fn();
    } finally {
      busyRef.current = false;
      setPending(null);
    }
  }, []);

  const isPending = useCallback((key?: string) => (key ? pending === key : pending !== null), [pending]);

  return { pending, run, isPending };
}
