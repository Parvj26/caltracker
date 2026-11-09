import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { messageYoutubeIds, photoDisplaySize, thumbPathOf, type Message, type OutboxItem } from '@caltracker/shared';
import { SharpPhoto, useNaturalSize } from '@/components/photo/sharp-photo';
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

/** A chat photo whole (uncropped) at its own shape, up to 240 x 320 points; a square until its size is known. */
function BubblePhoto({ pathKey, full, thumb }: { pathKey: string; full: string | undefined; thumb: string | undefined }) {
  const natural = useNaturalSize(pathKey, thumb ?? full);
  return <SharpPhoto full={full} thumb={thumb} size={photoDisplaySize(natural, PHOTO_BOX)} radius={radius.input} testID="message-photo" />;
}

const PHOTO_BOX = { maxWidth: 240, maxHeight: 320 };

/** One message: photos, text, YouTube cards, then the time (or Sending… / Didn't send · Retry) and "Seen". */
export function Bubble({ item, mine, seen, timeZone, urls, error, onRetry, onDelete, onOpenPhoto }: BubbleProps) {
  const { text } = useTheme();
  const pending = 'state' in item ? item : null;
  // A message still on its way shows its local files; a sent one shows the full photo (thumbnail as placeholder).
  const photos = item.imagePaths.map((p) => ({
    key: p,
    thumb: pending ? p : urls[thumbPathOf(p)],
    full: pending ? undefined : urls[p],
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
                style={({ pressed }) => [pressed && { opacity: pressedOpacity }]}
              >
                <BubblePhoto pathKey={p.key} full={p.full} thumb={p.thumb} />
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
  row: { maxWidth: '78%', gap: space[1] },
  rowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  rowTheirs: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  // The corner nearest the sender is tucked in (client right, coach left), as in the approved chat mockup.
  bubble: { borderRadius: 18, paddingHorizontal: space[3], paddingVertical: space[2.5], gap: space[2] },
  bubbleMine: { backgroundColor: palette.ink, borderBottomRightRadius: 6 },
  bubbleTheirs: { backgroundColor: palette.surface, borderBottomLeftRadius: 6 },
  bubbleFailed: { borderWidth: 2, borderColor: palette.magenta },
  mineText: { color: white },
  photos: { gap: space[1] },
  youtube: { gap: space[1] },
  youtubeImage: { width: 224, height: 126, borderRadius: radius.input, backgroundColor: palette.border },
  meta: { flexDirection: 'row', gap: space[1], alignItems: 'center' },
  retry: { textDecorationLine: 'underline', color: palette.ink },
});
