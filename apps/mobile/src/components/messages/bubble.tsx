import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { messageYoutubeIds, thumbPathOf, type Message, type OutboxItem } from '@caltracker/shared';
import { clockTime } from '@/lib/chat-format';
import { palette, pressedOpacity, radius, space, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

export type BubbleProps = {
  item: Message | OutboxItem;
  mine: boolean;
  seen: boolean;
  timeZone: string;
  /** Signed links by storage path. */
  urls: Record<string, string>;
  /** Why a failed message failed, if known. */
  error?: string | undefined;
  onRetry: (clientMsgId: string) => void;
  onDelete: (clientMsgId: string) => void;
  onOpenPhoto: (uri: string) => void;
};

/** One message: photos, text, YouTube cards, then the time (or Sending… / Didn't send · Retry) and "Seen". */
export function Bubble({ item, mine, seen, timeZone, urls, error, onRetry, onDelete, onOpenPhoto }: BubbleProps) {
  const { text } = useTheme();
  const pending = 'state' in item ? item : null;
  // A message still on its way shows its local files; a sent one shows the thumbnail and opens the full photo.
  const photos = item.imagePaths.map((p) => ({
    src: pending ? p : urls[thumbPathOf(p)],
    full: pending ? p : urls[p],
  }));
  const youtube = messageYoutubeIds(item.body);
  const failed = pending?.state === 'failed';
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]} testID={pending ? 'message-pending' : 'message'}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs, failed && styles.bubbleFailed]}>
        {photos.length > 0 ? (
          <View style={styles.photos}>
            {photos.map((p, i) => (
              <Pressable
                key={i}
                accessibilityRole="button"
                accessibilityLabel={`Open photo ${i + 1}`}
                disabled={!p.full}
                onPress={() => p.full && onOpenPhoto(p.full)}
                style={({ pressed }) => [styles.photo, photos.length === 1 && styles.photoOne, pressed && { opacity: pressedOpacity }]}
              >
                {p.src ? <Image source={{ uri: p.src }} style={styles.photoImage} accessibilityIgnoresInvertColors /> : null}
              </Pressable>
            ))}
          </View>
        ) : null}
        {item.body ? <Text style={[text('body'), mine && styles.mineText]} selectable>{item.body}</Text> : null}
        {youtube.map((id) => (
          <Pressable
            key={id}
            accessibilityRole="link"
            accessibilityLabel="Watch on YouTube"
            onPress={() => void Linking.openURL(`https://www.youtube.com/watch?v=${id}`)}
            style={({ pressed }) => [styles.youtube, pressed && { opacity: pressedOpacity }]}
          >
            <Image source={{ uri: `https://img.youtube.com/vi/${id}/hqdefault.jpg` }} style={styles.youtubeImage} accessibilityIgnoresInvertColors />
            <Text style={text('caption')}>Watch on YouTube</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.meta}>
        {pending ? (
          pending.state === 'sending' ? (
            <Text style={text('caption')} testID="message-sending">Sending…</Text>
          ) : (
            <>
              <Text style={text('caption')} testID="message-failed">Didn’t send ·</Text>
              <Pressable accessibilityRole="button" testID="message-retry" onPress={() => onRetry(item.clientMsgId)} hitSlop={space[2]}>
                <Text style={[text('caption'), styles.retry]}>Retry</Text>
              </Pressable>
              <Text style={text('caption')}>·</Text>
              <Pressable accessibilityRole="button" testID="message-delete" onPress={() => onDelete(item.clientMsgId)} hitSlop={space[2]}>
                <Text style={[text('caption'), styles.retry]}>Delete</Text>
              </Pressable>
            </>
          )
        ) : (
          <Text style={text('caption')}>{clockTime(item.createdAt, timeZone)}</Text>
        )}
        {seen ? <Text style={text('caption')} testID="message-seen">Seen</Text> : null}
      </View>
      {failed && error ? <Text style={text('caption')}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { maxWidth: '82%', gap: space[1] },
  rowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  rowTheirs: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { borderRadius: radius.card, paddingHorizontal: space[3.5], paddingVertical: space[2.5], gap: space[2] },
  bubbleMine: { backgroundColor: palette.ink },
  bubbleTheirs: { backgroundColor: palette.surface },
  bubbleFailed: { borderWidth: 2, borderColor: palette.magenta },
  mineText: { color: white },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
  photo: { width: 112, height: 112, borderRadius: radius.input, overflow: 'hidden', backgroundColor: palette.border },
  photoOne: { width: 224, height: 224 },
  photoImage: { width: '100%', height: '100%' },
  youtube: { gap: space[1] },
  youtubeImage: { width: 224, height: 126, borderRadius: radius.input, backgroundColor: palette.border },
  meta: { flexDirection: 'row', gap: space[1], alignItems: 'center' },
  retry: { textDecorationLine: 'underline', color: palette.ink },
});
