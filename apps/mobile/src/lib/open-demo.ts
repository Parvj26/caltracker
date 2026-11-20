import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';
import { openableDemoUrl } from './demo-link';

/**
 * Opens a demo link inside the app (Safari's in-app sheet, so Done brings the client straight back to the workout),
 * but only if it passes the check; anything else is ignored.
 */
export function openDemo(raw: string | null | undefined): void {
  const url = openableDemoUrl(raw);
  if (url) void openBrowserAsync(url, { presentationStyle: WebBrowserPresentationStyle.PAGE_SHEET, dismissButtonStyle: 'done' }).catch(() => undefined);
}
