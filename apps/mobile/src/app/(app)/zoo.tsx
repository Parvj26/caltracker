import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { AlbumGrid } from '@/components/stickers/album-grid';
import { Journey } from '@/components/stickers/journey';
import { StickerSheet } from '@/components/stickers/sticker-sheet';
import { SectionHeader } from '@/components/progress/parts';
import { Screen } from '@/components/ui';
import { weekKey } from '@caltracker/shared';
import { albumModel, type AlbumData, type AlbumItem } from '@/lib/album-logic';
import { deviceTimeZone } from '@/lib/awards';
import { useProgressFacts } from '@/lib/use-progress-facts';
import { usePullRefresh } from '@/lib/use-progress-data';
import { useUnits } from '@/lib/use-units';
import { useTheme } from '@/theme/use-theme';

/**
 * The zoo book: one scrolling album (streak journey, animals, rare finds, surprise drops). Its own screen (not a tab
 * since the Food tab), opened from Progress and Today through zooHref(). The book and streak are the same saved copy
 * and shared progressFacts as Today and Progress, so the numbers always agree.
 */
export default function ZooScreen() {
  const { text, space } = useTheme();
  const units = useUnits();
  const pull = usePullRefresh();
  // The same saved book and streak as Today and Progress (shared progressFacts).
  const { facts, album } = useProgressFacts(pull.refreshKey);
  const [open, setOpen] = useState<string | null>(null);
  const data: AlbumData | null = album.data ?? (album.status === 'offline' ? { awards: [], stats: null } : null);

  // The streak as it stands this week on the phone's calendar.
  const model = useMemo(
    () => albumModel(data?.awards ?? [], data?.stats ?? null, units ?? 'lb', weekKey(new Date().toISOString(), deviceTimeZone()), facts.streak?.current),
    [data, units, facts.streak],
  );
  const all = useMemo(
    () => new Map<string, AlbumItem>([...model.animals.items, ...model.rare.items, ...model.drops, ...model.journey.collected].map((i) => [i.key, i])),
    [model],
  );
  const opened = open ? (all.get(open) ?? null) : null;

  return (
    <Screen refreshing={pull.refreshing} onRefresh={pull.onRefresh}>
      <SectionHeader title="Zoo book" backTestID="zoo-back" backLabel="Back" />
      {album.status === 'offline' ? <Text style={text('caption')}>Showing your saved book. It updates when you’re online.</Text> : null}
      {facts.updating ? (
        <Text style={text('body')} testID="zoo-updating" accessibilityLiveRegion="polite">
          Updating… your latest workout is still syncing.
        </Text>
      ) : null}

      <Journey journey={model.journey} onOpen={setOpen} />

      <View style={{ gap: space[3] }}>
        <Text style={text('sectionHeading')} accessibilityRole="header" testID="zoo-animals-title">
          Animals
        </Text>
        <Text style={text('caption')} testID="zoo-animals-count">
          {model.animals.title}
        </Text>
        <AlbumGrid items={model.animals.items} onOpen={setOpen} />
      </View>

      <View style={{ gap: space[3] }}>
        <Text style={text('sectionHeading')} accessibilityRole="header">
          Rare finds
        </Text>
        <Text style={text('caption')} testID="zoo-rare-count">
          {model.rare.title}
        </Text>
        <AlbumGrid items={model.rare.items} onOpen={setOpen} />
      </View>

      <View style={{ gap: space[3] }}>
        <Text style={text('sectionHeading')} accessibilityRole="header">
          Surprise drops
        </Text>
        <AlbumGrid items={model.drops} onOpen={setOpen} hideLocked />
      </View>

      <StickerSheet item={opened} onClose={() => setOpen(null)} />
    </Screen>
  );
}
