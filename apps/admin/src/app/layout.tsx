import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque } from 'next/font/google';
import { toCssVariables } from '@caltracker/design-tokens';
import './globals.css';

const sans = Bricolage_Grotesque({ subsets: ['latin'], weight: ['500', '700', '800'], variable: '--ct-font-sans' });

export const metadata: Metadata = {
  title: { template: '%s · CalTracker admin', default: 'CalTracker admin' },
  description: 'CalTracker admin',
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { colorScheme: 'light' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <head>
        <style id="ct-tokens">{toCssVariables()}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
