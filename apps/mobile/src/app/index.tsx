import { Redirect } from 'expo-router';
import { landingHref } from '@/lib/landing';
import { useSession } from '@/lib/session';

// "/" belongs to neither guarded group, so signed-out and signed-in users both land somewhere valid.
// The root layout shows a spinner until the coach link is known, so `workspace` is settled here.
export default function Index() {
  const { session, workspace } = useSession();
  return <Redirect href={landingHref({ signedIn: session !== null, hasCoach: workspace !== null })} />;
}
