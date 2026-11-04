import styles from '../sign-in/sign-in.module.css';
import { SetPasswordForm } from './set-password-form';

export default function SetPasswordPage() {
  return (
    <main className={styles.main}>
      <h1>Set your password</h1>
      <p>Choose a password (at least 8 characters). You will use it with your email to sign in.</p>
      <SetPasswordForm />
    </main>
  );
}
