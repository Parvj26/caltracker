import type { Metadata } from 'next';
import Link from 'next/link';
import { TERMS_LAST_UPDATED } from '../last-updated';
import { LegalHeading, LegalSection, SupportEmail } from '../legal-page';
import styles from '../legal.module.css';

export const metadata: Metadata = { title: 'Terms of use' };

// Plain-language terms in the Privacy board's style. They name only CalTracker and the support address.
export default function TermsPage() {
  return (
    <>
      <LegalHeading title="Terms of use" updated={TERMS_LAST_UPDATED} />
      <div className={styles.summary}>
        <p className={styles.summaryTitle}>The short version</p>
        <p>
          CalTracker is a tool for you and your coach. Be kind in the community, train safely and ask a doctor about anything
          medical. You can delete your account whenever you like.
        </p>
      </div>
      <LegalSection title="What CalTracker is">
        <p>
          CalTracker is a coaching app. Coaches use the website to build workouts and programs, follow their clients’ progress
          and message them. Clients use the phone app to log workouts, food and body scans.
        </p>
      </LegalSection>
      <LegalSection title="Who can use it">
        <p>
          Accounts are by invite only. A coach invites you, and your account belongs to that coach’s space in CalTracker. Keep
          your password to yourself; you are responsible for what happens in your account.
        </p>
      </LegalSection>
      <LegalSection title="The community">
        <p>
          Be respectful. Don’t post anything hateful, harassing, sexual, violent or illegal, or anyone else’s private
          information or photos without their permission. Don’t spam, and don’t try to break into or overload CalTracker. Your
          coach can remove posts, and we can suspend accounts that break these rules.
        </p>
      </LegalSection>
      <LegalSection title="Not medical advice">
        <p>
          CalTracker and the plans in it are not medical advice. Talk to a doctor before starting a new training or eating plan,
          especially if you have an injury or a health condition, and stop if something hurts.
        </p>
      </LegalSection>
      <LegalSection title="Your coach’s content">
        <p>
          Workouts, programs, notes and other material a coach creates belong to that coach. Clients may use them for their own
          training but not copy or share them elsewhere. What you post stays yours; you let CalTracker store and show it so the
          app works.
        </p>
      </LegalSection>
      <LegalSection title="Deleting your account">
        <p>
          Clients can delete their account in the app at any time: Settings → Delete account. Coaches can close their account by
          emailing <SupportEmail />. See the <Link href="/privacy">privacy policy</Link> for what is erased.
        </p>
      </LegalSection>
      <LegalSection title="The service is provided as is">
        <p>
          We work hard to keep CalTracker running and your data safe, but the service is provided as is. We can’t promise it
          will always be available or free of mistakes, and we aren’t responsible for losses from using it, as far as the law
          allows.
        </p>
      </LegalSection>
      <LegalSection title="Changes to these terms">
        <p>
          If we change these terms, we update the date at the top of this page and tell you in the app or by email before the
          change takes effect. Using CalTracker after that means you accept the new terms.
        </p>
      </LegalSection>
      <LegalSection title="Contact">
        <p>
          Questions about these terms? Email <SupportEmail />.
        </p>
      </LegalSection>
    </>
  );
}
