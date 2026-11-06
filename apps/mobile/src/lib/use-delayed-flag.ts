import { useEffect, useState } from 'react';

/** True once `on` has stayed true for `delayMs`; false again as soon as it turns false. */
export function useDelayedFlag(on: boolean, delayMs: number): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!on) {
      setLate(false);
      return;
    }
    const t = setTimeout(() => setLate(true), delayMs);
    return () => clearTimeout(t);
  }, [on, delayMs]);
  return late;
}
