import Link from 'next/link';

/** "Privacy · Terms": the public legal pages, under the sign-in form and at the foot of the coach sidebar. */
export function LegalLinks({ className }: { className?: string | undefined }) {
  return (
    <nav aria-label="Legal" className={className}>
      <Link href="/privacy">Privacy</Link>
      <Link href="/terms">Terms</Link>
    </nav>
  );
}
