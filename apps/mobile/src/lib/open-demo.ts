import { Linking } from 'react-native';
import { openableDemoUrl } from './demo-link';

/** Opens a demo link in YouTube, but only if it passes the check; anything else is ignored. */
export function openDemo(raw: string | null | undefined): void {
  const url = openableDemoUrl(raw);
  if (url) void Linking.openURL(url).catch(() => undefined);
}
