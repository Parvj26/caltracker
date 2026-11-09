import { Stack } from 'expo-router';
import { palette } from '@/theme/theme';

/** Progress's section screens (Strength, Body, Personal bests, Consistency, Food), opened from the Progress tab's tiles. */
export default function ProgressDetailLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.bg } }} />;
}
