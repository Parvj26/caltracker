import { SignInForm } from './sign-in-form';
import styles from './sign-in.module.css';

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className={styles.main}>
      <h1>Sign in</h1>
      {error === 'link' ? (
        <p role="alert" className={styles.error}>
          That link has expired or was already used. Ask for a new invite, or sign in below if you already have a password.
        </p>
      ) : null}
      <SignInForm />
    </main>
  );
}
