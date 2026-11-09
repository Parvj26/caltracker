import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { borderWidth } from '@caltracker/design-tokens';
import { MAX_PHOTOS } from '@caltracker/shared';
import { CameraIcon } from '@/components/coach/icons';
import { PhotoError, compressPhoto } from '@/lib/compress-photo';
import type { OutboxPhoto } from '@/lib/outbox';
import { palette, pressedOpacity, radius, space, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { useAnalyticsTask } from '@/lib/analytics/use-analytics-task';

const BODY_MAX = 4000;

/**
 * The reply box: one-tap quick replies (each sends its words as a message), then the camera button (up to 4 photos,
 * shrunk on the phone, shown as removable thumbnails), the text box and Send.
 */
export function Composer({ onSend, placeholder = 'Write a message', quickReplies = [] }: {
  onSend: (draft: { body: string; photos: OutboxPhoto[] }) => void;
  placeholder?: string;
  quickReplies?: readonly string[];
}) {
  const { text } = useTheme();
  const [body, setBody] = useState('');
  // Starts when the client begins typing, so opening the Coach tab is not counted as a message given up.
  const completeMessage = useAnalyticsTask('message_coach', body.trim().length > 0);
  const [photos, setPhotos] = useState<OutboxPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSend = !busy && (body.trim() !== '' || photos.length > 0);

  async function pick() {
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) return;
    setError(null);
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: room,
      quality: 1,
    });
    if (res.canceled) return;
    setBusy(true);
    try {
      const picked = res.assets.slice(0, room);
      const done: OutboxPhoto[] = [];
      for (const a of picked) done.push(await compressPhoto({ uri: a.uri, width: a.width, height: a.height }));
      setPhotos((prev) => [...prev, ...done].slice(0, MAX_PHOTOS));
      if (res.assets.length > room) setError(`You can add up to ${MAX_PHOTOS} photos to a message.`);
    } catch (e) {
      setError(e instanceof PhotoError ? e.message : "Couldn't prepare that photo. Please try another.");
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    if (!canSend) return;
    completeMessage();
    onSend({ body, photos });
    setBody('');
    setPhotos([]);
    setError(null);
  }

  function sendQuick(reply: string) {
    completeMessage();
    onSend({ body: reply, photos: [] });
  }

  return (
    <View>
      {quickReplies.length > 0 ? (
        <View style={styles.chips}>
          {quickReplies.map((reply) => (
            <Pressable
              key={reply}
              testID="coach-quick-reply"
              accessibilityRole="button"
              accessibilityLabel={reply}
              accessibilityHint="Sends this message"
              onPress={() => sendQuick(reply)}
              style={({ pressed }) => [styles.chip, pressed && { opacity: pressedOpacity }]}
            >
              <Text style={[text('sectionHeading'), styles.chipText]}>{reply}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    <View style={styles.wrap}>
      {photos.length > 0 ? (
        <View style={styles.thumbs}>
          {photos.map((p, i) => (
            <View key={p.id} style={styles.thumb}>
              <Image source={{ uri: p.thumbUri }} style={styles.thumbImage} accessibilityIgnoresInvertColors />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove photo ${i + 1}`}
                onPress={() => setPhotos((prev) => prev.filter((x) => x.id !== p.id))}
                style={styles.remove}
                hitSlop={space[2]}
              >
                <Text style={[text('caption'), styles.removeText]}>×</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {error ? <Text style={text('caption')} accessibilityRole="alert">{error}</Text> : null}
      <View style={styles.row}>
        <Pressable
          testID="coach-photo-button"
          accessibilityRole="button"
          accessibilityLabel="Add photos"
          disabled={busy || photos.length >= MAX_PHOTOS}
          onPress={() => void pick()}
          style={({ pressed }) => [styles.photoButton, (busy || photos.length >= MAX_PHOTOS) && styles.disabled, pressed && { opacity: pressedOpacity }]}
        >
          <CameraIcon />
        </Pressable>
        <TextInput
          testID="coach-composer-input"
          accessibilityLabel="Message"
          placeholder={placeholder}
          placeholderTextColor={palette.inkMuted}
          multiline
          maxLength={BODY_MAX}
          value={body}
          onChangeText={setBody}
          style={[text('body'), styles.input]}
        />
        <Pressable
          testID="coach-send"
          accessibilityRole="button"
          accessibilityLabel="Send"
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          onPress={submit}
          style={({ pressed }) => [styles.send, !canSend && styles.disabled, pressed && { opacity: pressedOpacity }]}
        >
          <Text style={[text('button'), styles.sendText]}>Send</Text>
        </Pressable>
      </View>
    </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], paddingHorizontal: space[4], paddingBottom: space[2] },
  chip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    borderWidth: borderWidth.secondaryButton,
    borderColor: palette.ink,
    backgroundColor: palette.bg,
  },
  chipText: { fontSize: 14 },
  wrap: { gap: space[2], paddingHorizontal: space[3], paddingVertical: space[2], backgroundColor: palette.bg, borderTopWidth: borderWidth.card, borderTopColor: palette.border },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: space[2] },
  photoButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surface },
  input: {
    flex: 1,
    maxHeight: 132,
    minHeight: 44,
    borderRadius: 22,
    borderWidth: borderWidth.secondaryButton,
    borderColor: palette.ink,
    paddingHorizontal: space[3.5],
    paddingTop: space[3],
    paddingBottom: space[3],
  },
  send: {
    minHeight: 44,
    minWidth: 64,
    paddingHorizontal: space[4],
    borderRadius: 22,
    borderWidth: borderWidth.card,
    borderColor: palette.ink,
    backgroundColor: palette.lime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: { color: palette.ink },
  disabled: { opacity: 0.4 },
  thumbs: { flexDirection: 'row', gap: space[2] },
  thumb: { width: 64, height: 64 },
  thumbImage: { width: 64, height: 64, borderRadius: radius.input, backgroundColor: palette.border },
  remove: { position: 'absolute', top: -6, right: -6, width: 24, height: 24, borderRadius: 12, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' },
  removeText: { color: white, lineHeight: 16 },
});
