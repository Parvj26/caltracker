import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { notificationText, postAge } from '@caltracker/shared';
import { Screen, TextButton } from '@/components/ui';
import { markNotificationsRead, namesOf } from '@/lib/community-api';
import { useCommunity } from '@/lib/use-community';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/**
 * In-app notifications: comments on my posts, reactions (grouped: "Sam and 4 others reacted to your post") and new posts by
 * the coach. Opening the list marks everything read; unread items keep their dot until the next visit.
 */
export default function NotificationsScreen() {
  const router = useRouter();
  const { text, space, radius } = useTheme();
  const { notifications, refreshNotifications } = useCommunity();
  const [names, setNames] = useState<Record<string, string>>({});
  // What was unread when the list opened, so the dots stay while it is on screen.
  const [unreadKeys, setUnreadKeys] = useState<Set<string> | null>(null);
  const actorKey = useMemo(() => [...new Set(notifications.flatMap((n) => n.actorIds))].sort().join(','), [notifications]);

  useFocusEffect(
    useCallback(() => {
      void refreshNotifications();
    }, [refreshNotifications]),
  );

  useEffect(() => {
    if (unreadKeys !== null || notifications.length === 0) return;
    setUnreadKeys(new Set(notifications.filter((n) => n.unread).map((n) => n.key)));
    if (notifications.some((n) => n.unread)) void markNotificationsRead().then(refreshNotifications).catch(() => undefined);
  }, [notifications, unreadKeys, refreshNotifications]);

  useEffect(() => {
    let alive = true;
    void namesOf(actorKey ? actorKey.split(',') : []).then((n) => alive && setNames(n)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [actorKey]);

  const now = Date.now();
  return (
    <Screen>
      <View style={styles.row}>
        <TextButton title="Back" testID="notifications-back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/community'))} />
      </View>
      <Text style={text('screenTitle')} accessibilityRole="header">
        Notifications
      </Text>
      {notifications.length === 0 ? <Text style={text('body')}>Nothing yet. Reactions and comments on your posts show up here.</Text> : null}
      {notifications.map((n) => {
        const unread = unreadKeys?.has(n.key) ?? n.unread;
        return (
          <Pressable
            key={n.key}
            testID={`notification-${n.kind}`}
            accessibilityRole="button"
            accessibilityLabel={`${unread ? 'New. ' : ''}${notificationText(n, (id) => names[id] ?? 'Someone')}`}
            disabled={!n.postId}
            onPress={() => n.postId && router.push({ pathname: '/community/[id]', params: { id: n.postId } })}
            style={({ pressed }) => [styles.item, { borderRadius: radius.card, padding: space[4], gap: space[3] }, pressed && { opacity: pressedOpacity }]}
          >
            {unread ? <View style={[styles.dot, { borderRadius: radius.pill }]} /> : null}
            <View style={styles.flex}>
              <Text style={text('body')}>{notificationText(n, (id) => names[id] ?? 'Someone')}</Text>
              <Text style={text('caption')}>{postAge(n.createdAt, now)}</Text>
            </View>
          </Pressable>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  item: { flexDirection: 'row', alignItems: 'center', backgroundColor: palette.surface, minHeight: 44 },
  dot: { width: 10, height: 10, backgroundColor: palette.magenta },
});
