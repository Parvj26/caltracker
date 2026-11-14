import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Caveat } from 'next/font/google';
import { toCssVariables } from '@caltracker/design-tokens';
import './globals.css';

const sans = Bricolage_Grotesque({ subsets: ['latin'], weight: ['500', '700', '800'], variable: '--ct-font-sans' });
const hand = Caveat({ subsets: ['latin'], weight: '700', variable: '--ct-font-hand' });

// Pages name themselves ("Home", "Maya Patel · Clients"); the template adds the product name to every tab.
export const metadata: Metadata = { title: { template: '%s · CalTracker', default: 'CalTracker' }, description: 'Coach dashboard',
  // iOS Safari turns long digit runs (names like "Week 1794…") into phone links, which breaks hydration.
  formatDetection: { telephone: false },
};
export const viewport: Viewport = { colorScheme: 'light' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${hand.variable}`}>
      <head>
        <style id="ct-tokens">{toCssVariables()}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
