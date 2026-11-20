import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { Card, HandNote, Logo, Screen } from '@/components/ui';
import { useTheme } from '@/theme/use-theme';

/**
 * Branded frame for the signed-out screens: logo, then the form card. No sample stat tiles (product owner,
 * 2026-11-19): made-up numbers ("Streak 12") read as the client's own.
 */
export function AuthShell({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  const { text, space } = useTheme();
  return (
    <Screen centred>
      <Logo size="lg" />
      <Card>
        <View style={{ gap: space[2] }}>
          <Text style={text('screenTitle')} accessibilityRole="header">
            {title}
          </Text>
          {note ? <HandNote>{note}</HandNote> : null}
        </View>
        {children}
      </Card>
    </Screen>
  );
}
