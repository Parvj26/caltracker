// Starting a workout from the Workouts tab and its Preview: one workout at a time (the one going is offered
// instead), a planned workout from the server's newest copy when it answers quickly, else the copy already on
// screen, so Start works with poor signal.
import { useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';
import type { WorkoutDoc } from '@caltracker/shared';
import { within } from './active-log-logic';
import { useActiveLog } from './use-active-log';
import { fetchWorkoutDetail } from './workouts-api';

/** How long Start waits for the server before using the copy on screen. */
const DETAIL_WAIT_MS = 5000;
export const START_FAILED = 'Couldn’t start a workout. Try again.';

export function useStartWorkout() {
  const router = useRouter();
  const { log: active, start, startEmpty } = useActiveLog();
  // 'unplanned' or the planned workout's id while it starts.
  const [starting, setStarting] = useState<string | null>(null);
  // The guard itself is a ref: state only updates on the next render, so two quick taps could both get past it.
  const startingRef = useRef(false);
  const inProgress = active?.status === 'in_progress' ? active : null;

  const openLog = useCallback((id: string) => router.push({ pathname: '/log/[id]', params: { id } }), [router]);
  const openSummary = useCallback(
    (id: string) => router.push({ pathname: '/log/[id]/summary', params: { id } }),
    [router],
  );

  /** False (and offers the workout going) when another one is in progress. */
  const isFree = useCallback((): boolean => {
    if (!inProgress) return true;
    Alert.alert(`${inProgress.name} is still going`, 'Finish or discard it before starting another workout.', [
      { text: 'Cancel', style: 'cancel' },
      { text: `Resume ${inProgress.name}`, onPress: () => openLog(inProgress.id) },
    ]);
    return false;
  }, [inProgress, openLog]);

  const startPlanned = useCallback(
    async (doc: WorkoutDoc) => {
      if (startingRef.current) return;
      if (inProgress?.workoutId === doc.id) {
        openLog(inProgress.id);
        return;
      }
      if (!isFree()) return;
      startingRef.current = true;
      setStarting(doc.id);
      try {
        const fresh = await within(fetchWorkoutDetail(doc.id), DETAIL_WAIT_MS);
        const log = await start(fresh?.doc ?? doc);
        openLog(log.id);
      } catch {
        Alert.alert(START_FAILED);
      } finally {
        startingRef.current = false;
        setStarting(null);
      }
    },
    [inProgress, isFree, openLog, start],
  );

  /** True when the unplanned workout started (the naming sheet can close). */
  const startUnplanned = useCallback(
    async (name: string): Promise<boolean> => {
      if (startingRef.current) return false;
      startingRef.current = true;
      setStarting('unplanned');
      try {
        const log = await startEmpty(name);
        openLog(log.id);
        return true;
      } catch {
        Alert.alert(START_FAILED);
        return false;
      } finally {
        startingRef.current = false;
        setStarting(null);
      }
    },
    [openLog, startEmpty],
  );

  return { starting, inProgress, isFree, openLog, openSummary, startPlanned, startUnplanned };
}
