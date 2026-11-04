import { Redirect } from 'expo-router';
import { useSession } from '@/lib/session';

// "/" belongs to neither guarded group, so signed-out and signed-in users both land somewhere valid.
export default function Index() {
  const { session } = useSession();
  return <Redirect href={session ? '/home' : '/sign-in'} />;
}
