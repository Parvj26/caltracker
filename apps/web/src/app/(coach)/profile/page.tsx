import { CoachAvatar } from '@/components/coach-avatar';
import { Card } from '@/components/ui';
import { coachAvatarUrl } from '@/lib/avatar-url';
import { requireCoach } from '@/lib/auth';
import { AvatarPicker } from './avatar-picker';
import { PasswordForm } from './password-form';
import { ProfileForm } from './profile-form';
import { SignOut } from './sign-out';
import styles from './profile.module.css';

export const metadata = { title: 'Profile' };

export default async function ProfilePage() {
  const coach = await requireCoach();
  const avatarUrl = await coachAvatarUrl();
  const fullName = `${coach.firstName} ${coach.lastName}`.trim() || coach.email;

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>Profile</h1>
        <p className={styles.caption}>Your clients see your photo, name, business and bio in the app.</p>
      </header>

      <Card className={styles.card}>
        <h2 className={styles.sectionHeading}>Photo</h2>
        <AvatarPicker
          hasPhoto={avatarUrl !== null}
          preview={<CoachAvatar url={avatarUrl} name={fullName} seed={coach.userId} size="large" />}
        />
      </Card>

      <Card className={styles.card}>
        <h2 className={styles.sectionHeading}>Your details</h2>
        <ProfileForm
          email={coach.email}
          initial={{
            firstName: coach.firstName,
            lastName: coach.lastName,
            businessName: coach.workspaceName,
            bio: coach.bio,
            units: coach.units,
          }}
        />
      </Card>

      <Card className={styles.card}>
        <h2 className={styles.sectionHeading}>Change password</h2>
        <PasswordForm />
      </Card>

      <div className={styles.signOutRow}>
        <SignOut />
      </div>
    </div>
  );
}
