import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { AlbumGrid } from '@/components/stickers/album-grid';
import { Journey } from '@/components/stickers/journey';
import { StickerSheet } from '@/components/stickers/sticker-sheet';
import { Screen } from '@/components/ui';
import { weekKey } from '@caltracker/shared';
import { fetchAlbum, readCachedAlbum } from '@/lib/album-api';
import { albumModel, type AlbumData, type AlbumItem } from '@/lib/album-logic';
import { deviceTimeZone } from '@/lib/awards';
import { useSession } from '@/lib/session';
import { useUnits } from '@/lib/use-units';
import { useTheme } from '@/theme/use-theme';

/** The zoo book: one scrolling album (streak journey, animals, rare finds, surprise drops). */
export default function ZooScreen() {
  const { text, space } = useTheme();
  const { session, workspace } = useSession();
  const userId = session?.user.id ?? null;
  const workspaceId = workspace?.workspaceId ?? null;
  const units = useUnits();
  const [data, setData] = useState<AlbumData | null>(null);
  const [offline, setOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  // A different account or coach: drop the book on screen, so nothing from the last one shows while loading.
  useEffect(() => {
    setData(null);
  }, [userId, workspaceId]);

  const load = useCallback(async () => {
    if (!userId || !workspaceId) return;
    // The saved copy first, so the book appears at once and works with no signal.
    const cached = await readCachedAlbum(userId, workspaceId);
    if (cached) setData((d) => d ?? cached);
    try {
      setData(await fetchAlbum(userId, workspaceId));
      setOffline(false);
    } catch {
      setOffline(true);
      setData((d) => d ?? { awards: [], stats: null });
    }
  }, [userId, workspaceId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // The streak as it stands this week on the phone's calendar (worked out again each time the book is loaded).
  const model = useMemo(
    () => albumModel(data?.awards ?? [], data?.stats ?? null, units ?? 'lb', weekKey(new Date().toISOString(), deviceTimeZone())),
    [data, units],
  );
  const all = useMemo(
    () => new Map<string, AlbumItem>([...model.animals.items, ...model.rare.items, ...model.drops, ...model.journey.collected].map((i) => [i.key, i])),
    [model],
  );
  const opened = open ? (all.get(open) ?? null) : null;

  return (
    <Screen
      inTabs
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void load().finally(() => setRefreshing(false));
      }}
    >
      <Text style={text('screenTitle')} accessibilityRole="header">
        Zoo book
      </Text>
      {offline ? <Text style={text('caption')}>Showing your saved book. It updates when you’re online.</Text> : null}

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
