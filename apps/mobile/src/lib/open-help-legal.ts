import * as Application from 'expo-application';
import * as Device from 'expo-device';
import { Alert, Linking } from 'react-native';
import { SUPPORT_EMAIL } from '@caltracker/shared';
import { deviceLabel, helpMailto, releaseLabel, type HelpLegalRow } from './help-legal';

/** "1.0.0 (3)" for this install. */
export const appRelease = () => releaseLabel(Application.nativeApplicationVersion, Application.nativeBuildVersion);

/**
 * Opens a HELP & LEGAL row: the web page for Privacy and Terms (expo-web-browser isn't a dependency, so Safari opens),
 * or an email to support for Help. With no mail account set up the email can't open, so the address is shown instead.
 */
export async function openHelpLegal(row: HelpLegalRow): Promise<void> {
  const url = row.url ?? helpMailto(appRelease(), deviceLabel(Device.modelName, Device.osName, Device.osVersion));
  try {
    await Linking.openURL(url);
  } catch {
    if (row.key === 'help') Alert.alert('Help & feedback', `Email us at ${SUPPORT_EMAIL}`);
    else Alert.alert(row.label, `Open ${url} in your browser.`);
  }
}
