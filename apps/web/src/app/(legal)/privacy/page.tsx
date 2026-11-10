import type { Metadata } from 'next';
import { PRIVACY_LAST_UPDATED } from '../last-updated';
import { LegalHeading, LegalSection, SupportEmail } from '../legal-page';
import styles from '../legal.module.css';

export const metadata: Metadata = { title: 'Privacy policy' };

// Copy from the approved Privacy board (account canvas). It names only CalTracker and the support address.
export default function PrivacyPage() {
  return (
    <>
      <LegalHeading title="Privacy policy" updated={PRIVACY_LAST_UPDATED} />
      <div className={styles.summary}>
        <p className={styles.summaryTitle}>The short version</p>
        <p>
          Your coach sees your training, food and body data so they can coach you. We never sell your data or show ads. You can
          delete your account and everything in it from the app at any time.
        </p>
      </div>
      <LegalSection title="Who we are">
        <p>
          CalTracker is a coaching app. For anything about your data or this policy, email <SupportEmail />.
        </p>
      </LegalSection>
      <LegalSection title="What we collect">
        <p>
          Your name and email; workouts, sets and personal bests; meals and food targets; body scans and goals; messages, photos
          and community posts; your phone’s notification token; and how you use the app (taps and screens) to improve it.
        </p>
      </LegalSection>
      <LegalSection title="Who can see it">
        <p>
          Your coach sees your training, food, body data and messages. Other clients see only what you post in your coach’s
          community. CalTracker staff look at accounts only to fix problems, and every look is logged.
        </p>
      </LegalSection>
      <LegalSection title="Services we use">
        <p>
          Supabase (database and file storage), Cloudflare (website), Resend (emails), Apple (notifications) and PostHog (usage
          statistics). They only process data to run CalTracker.
        </p>
      </LegalSection>
      <LegalSection title="Deleting your data">
        <p>
          Settings → Delete account erases your account and everything in it right away. Coaches can close their account by
          emailing <SupportEmail />.
        </p>
      </LegalSection>
      <LegalSection title="Your rights">
        <p>
          You can ask for a copy of your data or to correct it by emailing <SupportEmail />. We reply within 30 days.
        </p>
      </LegalSection>
    </>
  );
}
