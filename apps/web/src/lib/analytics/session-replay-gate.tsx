'use client';

import { useEffect } from 'react';
import { startReplay, stopReplay } from './client';

/** Placed only in the coach layout: pages under (coach) may be recorded, nothing else is. */
export function SessionReplayGate(): null {
  useEffect(() => {
    startReplay();
    return () => stopReplay();
  }, []);
  return null;
}
