import { AuthShell, ErrorText } from '@/components/ui';
import { SignInForm } from './sign-in-form';
import styles from './sign-in.module.css';

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <AuthShell title="Sign in" note="Welcome back, coach!">
      {error === 'link' ? (
        <ErrorText className={styles.notice}>
          That link has expired or was already used. Use &quot;Forgot password?&quot; below to get a new link, or sign in if you already have a password.
        </ErrorText>
      ) : null}
      <SignInForm />
    </AuthShell>
  );
}
