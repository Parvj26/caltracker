import { Redirect } from 'expo-router';

/** The old Body screen is now Metrics; anything still linking here lands there. */
export default function BodyScreen() {
  return <Redirect href="/progress-detail/metrics" />;
}
