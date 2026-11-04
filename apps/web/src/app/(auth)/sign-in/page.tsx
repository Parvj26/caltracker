import { SignInForm } from './sign-in-form';
import styles from './sign-in.module.css';

export default function SignInPage() {
  return (
    <main className={styles.main}>
      <h1>Sign in</h1>
      <SignInForm />
    </main>
  );
}
