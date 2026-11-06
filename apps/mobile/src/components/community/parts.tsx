import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, StyleSheet, Text, View } from 'react-native';
import { cardText, splitLinks, type CommunityCard, type Units } from '@caltracker/shared';
import { Sticker } from '@/components/stickers/sticker';
import { signedUrls } from '@/lib/community-api';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/** Renew a bit before the hour-long links run out. */
const RESIGN_AFTER_MS = 50 * 60 * 1000;

/** Short-lived signed links for private files, renewed before they run out and when the app returns. */
export function useSignedUrls(bucket: string, paths: string[]): Record<string, string> {
  const [signed, setSigned] = useState<Record<string, { url: string; at: number }>>({});
  const ref = useRef(signed);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    ref.current = signed;
  });
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && setTick((t) => t + 1));
    return () => sub.remove();
  }, []);
  const key = paths.join('|');
  useEffect(() => {
    const wanted = key ? key.split('|') : [];
    const stale = wanted.filter((p) => {
      const have = ref.current[p];
      return !have || Date.now() - have.at > RESIGN_AFTER_MS;
    });
    if (stale.length === 0) return;
    let alive = true;
    void signedUrls(bucket, stale)
      .then((urls) => {
        if (!alive) return;
        const at = Date.now();
        setSigned((prev) => {
          const next = { ...prev };
          for (const [p, url] of Object.entries(urls)) next[p] = { url, at };
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [bucket, key, tick]);
  const out: Record<string, string> = {};
  for (const [p, v] of Object.entries(signed)) out[p] = v.url;
  return out;
}

/** Post or comment text; http(s) links open in the browser. */
export function LinkedText({ text, testID }: { text: string; testID?: string }) {
  const { text: t } = useTheme();
  return (
    <Text style={t('body')} testID={testID} selectable>
      {splitLinks(text).map((s, i) =>
        s.kind === 'link' ? (
          <Text
            key={i}
            style={styles.link}
            accessibilityRole="link"
            onPress={() => void Linking.openURL(s.href)}
          >
            {s.text}
          </Text>
        ) : (
          <Text key={i}>{s.text}</Text>
        ),
      )}
    </Text>
  );
}

/** A shared sticker / workout / PR card, in the reader's own units. */
export function CardView({ card, units }: { card: CommunityCard; units: Units }) {
  const { text, space, radius } = useTheme();
  const c = cardText(card, units);
  return (
    <View style={[styles.card, { borderRadius: radius.card, padding: space[4], gap: space[3] }]} testID="community-card">
      {c.stickerKey ? <Sticker stickerKey={c.stickerKey} size={72} shiny={c.shiny} variant="sm" /> : null}
      <View style={[styles.cardText, { gap: space[1] }]}>
        <Text style={[text('caption'), styles.ink]}>{c.badge}</Text>
        <Text style={[text('sectionHeading'), styles.ink]}>{c.title}</Text>
        {c.lines.map((l) => (
          <Text key={l} style={[text('caption'), styles.ink]}>
            {l}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  link: { textDecorationLine: 'underline', color: palette.ink },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: palette.lime },
  cardText: { flex: 1 },
  ink: { color: palette.ink },
});
