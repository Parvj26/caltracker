import type { Metadata } from 'next';
import { AuthShell } from '@/components/ui';
import { SignInForm } from './sign-in-form';

export const metadata: Metadata = { title: 'Sign in' };

export default function SignInPage() {
  return (
    <AuthShell title="Sign in">
      <SignInForm />
    </AuthShell>
  );
}
