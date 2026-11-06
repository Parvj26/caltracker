import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AlbumItem } from '@/lib/album-logic';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { Sticker } from './sticker';

const ART = 84;

/**
 * A grid of stickers. Owned ones are tappable and carry a ×N badge (and ✦ with the foil when shiny); locked ones are
 * silhouettes, with their requirement under them when they have one. `hidden` stickers (surprise drops) show "???".
 */
export function AlbumGrid({
  items,
  onOpen,
  hideLocked = false,
}: {
  items: AlbumItem[];
  onOpen: (key: string) => void;
  /** Locked stickers show "???" instead of a silhouette and a name (the surprise drops). */
  hideLocked?: boolean;
}) {
  const { text, space, radius } = useTheme();
  return (
    <View style={[styles.grid, { gap: space[3] }]}>
      {items.map((it) => (
        <Pressable
          key={it.key}
          testID={it.owned ? `sticker-${it.key}` : `locked-${hideLocked ? 'drop' : it.key}`}
          disabled={!it.owned}
          accessibilityRole={it.owned ? 'button' : undefined}
          accessibilityLabel={
            it.owned
              ? `${it.name}${it.shiny ? ', shiny' : ''}, ${it.count} collected`
              : hideLocked
                ? 'Surprise drop, not found yet'
                : `${it.name}, locked${it.requirement ? `, needs ${it.requirement}` : ''}`
          }
          onPress={() => onOpen(it.key)}
          style={({ pressed }) => [styles.cell, { gap: space[1], opacity: pressed ? pressedOpacity : 1 }]}
        >
          <View style={styles.art}>
            {it.owned ? (
              <Sticker stickerKey={it.key} size={ART} shiny={it.shiny} variant="sm" />
            ) : hideLocked ? (
              <View style={[styles.mystery, { borderRadius: radius.card }]}>
                <Text style={text('sectionHeading')}>???</Text>
              </View>
            ) : (
              <Sticker stickerKey={it.key} size={ART} variant="locked" />
            )}
            {it.owned && it.badge ? (
              <View style={[styles.badge, { borderRadius: radius.pill, paddingHorizontal: space[1] }]}>
                <Text style={[text('caption'), styles.badgeText]}>
                  {it.shiny ? '✦ ' : ''}
                  {it.badge}
                </Text>
              </View>
            ) : null}
          </View>
          {it.owned ? (
            <Text style={[text('caption'), styles.label]} numberOfLines={1}>
              {it.name}
            </Text>
          ) : it.requirement ? (
            <Text style={[text('caption'), styles.label]}>{it.requirement}</Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '30%', flexGrow: 1, alignItems: 'center' },
  art: { width: ART * 1.35, height: ART * 1.1, alignItems: 'center', justifyContent: 'center' },
  mystery: { width: ART, height: ART, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', right: 0, bottom: 0, backgroundColor: palette.ink },
  badgeText: { color: palette.bg },
  label: { textAlign: 'center' },
});
