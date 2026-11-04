import styles from '../sign-in/sign-in.module.css';
import { ForgotPasswordForm } from './forgot-password-form';

export default function ForgotPasswordPage() {
  return (
    <main className={styles.main}>
      <h1>Forgot your password?</h1>
      <p>Enter your email and we will send you a link to choose a new one.</p>
      <ForgotPasswordForm />
      <p><a href="/sign-in">Back to sign in</a></p>
    </main>
  );
}
