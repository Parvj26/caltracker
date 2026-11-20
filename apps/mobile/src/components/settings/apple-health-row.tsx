import { HeartTile, LinkRow } from '@/components/metrics/parts';
import { appleHealthStatus } from '@/lib/apple-health-logic';
import { useAppleHealth } from '@/lib/apple-health-sync';

/** The Settings sheet's "Apple Health ›" row with its state ("Off", "Synced 5 min ago"). Hidden where HealthKit is not. */
export function AppleHealthRow({ onPress }: { onPress: () => void }) {
  const { available, state } = useAppleHealth();
  if (!available || !state) return null;
  return <LinkRow testID="settings-apple-health" icon={<HeartTile size={32} />} title="Apple Health" sub={appleHealthStatus(state, new Date())} onPress={onPress} />;
}
