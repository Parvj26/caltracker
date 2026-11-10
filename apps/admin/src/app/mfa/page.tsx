import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/ui';
import { createServerSupabase } from '@/lib/supabase/server';
import { MfaForm } from './mfa-form';

export const metadata: Metadata = { title: 'Two-step sign-in' };

/** After the password: set up two-step the first time (QR code), otherwise enter the 6-digit code. */
export default async function MfaPage() {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/sign-in');
  const me = await supabase.rpc('admin_me');
  if (me.error) throw new Error(`Could not check admin access: ${me.error.message}`);
  if (me.data.length === 0) redirect('/auth/denied');

  const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal.data?.currentLevel === 'aal2') redirect('/overview');

  const factors = await supabase.auth.mfa.listFactors();
  if (factors.error) throw new Error(`Could not load two-step: ${factors.error.message}`);
  const verified = factors.data.totp[0];

  return (
    <AuthShell title={verified ? 'Two-step sign-in' : 'Set up two-step sign-in'}>
      <MfaForm factorId={verified?.id ?? null} />
    </AuthShell>
  );
}
