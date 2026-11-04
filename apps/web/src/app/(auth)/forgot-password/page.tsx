import { AuthShell } from '@/components/ui';
import { ForgotPasswordForm } from './forgot-password-form';
import styles from '../sign-in/sign-in.module.css';

export default function ForgotPasswordPage() {
  return (
    <AuthShell title="Forgot your password?">
      <p className={styles.lead}>Enter your email and we will send you a link to choose a new one.</p>
      <ForgotPasswordForm />
      <a href="/sign-in" className={styles.forgot}>Back to sign in</a>
    </AuthShell>
  );
}
