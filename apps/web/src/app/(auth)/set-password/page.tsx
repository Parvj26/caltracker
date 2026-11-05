import { AuthShell } from '@/components/ui';
import { SetPasswordForm } from './set-password-form';
import styles from '../sign-in/sign-in.module.css';

export default function SetPasswordPage() {
  return (
    <AuthShell title="Set your password">
      <p className={styles.lead}>Choose a password (at least 8 characters). You will use it with your email to sign in.</p>
      <SetPasswordForm />
    </AuthShell>
  );
}
