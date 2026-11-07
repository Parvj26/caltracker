import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { signedUrls } from '@/lib/messages-api';

/** Renew a bit before the hour-long links run out. */
const RESIGN_AFTER_MS = 50 * 60 * 1000;

/** Short-lived signed links for private photos, renewed before they run out and when the app returns. */
export function useSignedUrls(paths: string[]): Record<string, string> {
  const [signed, setSigned] = useState<Record<string, { url: string; at: number }>>({});
  const ref = useRef(signed);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    ref.current = signed;
  });
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && setTick((t) => t + 1));
    return () => sub.remove();
  }, []);
  const key = paths.join('|');
  useEffect(() => {
    const wanted = key ? key.split('|') : [];
    const stale = wanted.filter((p) => {
      const have = ref.current[p];
      return !have || Date.now() - have.at > RESIGN_AFTER_MS;
    });
    if (stale.length === 0) return;
    let alive = true;
    void signedUrls(stale).then((urls) => {
      if (!alive) return;
      const at = Date.now();
      setSigned((prev) => {
        const next = { ...prev };
        for (const [p, url] of Object.entries(urls)) next[p] = { url, at };
        return next;
      });
    });
    return () => {
      alive = false;
    };
  }, [key, tick]);
  const out: Record<string, string> = {};
  for (const [p, v] of Object.entries(signed)) out[p] = v.url;
  return out;
}
