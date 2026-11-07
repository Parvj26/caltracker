import { useSyncExternalStore } from 'react';

const subscribeMinute = (onChange: () => void) => {
  const timer = setInterval(onChange, 30_000);
  return () => clearInterval(timer);
};
const minuteNow = () => Math.floor(Date.now() / 60_000);

/** The browser's clock to the minute, or null on the server and during hydration (ages and clocks wait for it). */
export function useNowMinute(): Date | null {
  const minute = useSyncExternalStore(subscribeMinute, minuteNow, () => null);
  return minute === null ? null : new Date(minute * 60_000);
}
