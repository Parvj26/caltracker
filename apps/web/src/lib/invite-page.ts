import QRCode from 'qrcode';

// Phones and tablets that announce themselves. iPads on iPadOS 13+ send a desktop (Macintosh) user agent; they still
// get the QR code, which is harmless there, and "Open in CalTracker" stays on the page for every device.
const MOBILE_UA = /Mobi|Android|iPhone|iPad|iPod|Windows Phone|webOS|BlackBerry|Opera Mini|IEMobile/i;

/** True for a phone or tablet user agent. A missing user agent counts as mobile, so phones never get extra content. */
export function isMobileUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true;
  return MOBILE_UA.test(userAgent);
}

/** The public invite URL, rebuilt from the request's own host so it matches the link the client opened. */
export function inviteUrlFrom(host: string | null, proto: string | null, token: string): string | null {
  if (!host || !/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) return null;
  const scheme = proto === 'http' || proto === 'https' ? proto : host.startsWith('localhost') ? 'http' : 'https';
  return `${scheme}://${host}/invite/${encodeURIComponent(token)}`;
}

/** An inline SVG QR code for `text`, drawn in brand ink on white. Generated on the server; no image service. */
export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 2,
    color: { dark: '#121212', light: '#FFFFFF' },
  });
}

export type StoreLink = { label: string; href: string };

/** The app store links that are configured. Empty until the apps are published. */
export function storeLinks(appStoreUrl: string | undefined, playStoreUrl: string | undefined): StoreLink[] {
  const links: StoreLink[] = [];
  if (appStoreUrl) links.push({ label: 'App Store', href: appStoreUrl });
  if (playStoreUrl) links.push({ label: 'Google Play', href: playStoreUrl });
  return links;
}
