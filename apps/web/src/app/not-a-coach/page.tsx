import { AuthShell, Button } from '@/components/ui';

export default function NotACoachPage() {
  return (
    <AuthShell title="This dashboard is for coaches. Clients use the CalTracker app.">
      <form action="/auth/sign-out" method="post">
        <Button type="submit" variant="secondary">Sign out</Button>
      </form>
    </AuthShell>
  );
}
