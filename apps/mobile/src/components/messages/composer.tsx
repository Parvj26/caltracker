import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MAX_PHOTOS } from '@caltracker/shared';
import { PhotoError, compressPhoto } from '@/lib/compress-photo';
import type { OutboxPhoto } from '@/lib/outbox';
import { palette, pressedOpacity, radius, space, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const BODY_MAX = 4000;

/** The reply box: 📷 adds up to 4 photos (shrunk on the phone) shown as removable thumbnails, then Send. */
export function Composer({ onSend }: { onSend: (draft: { body: string; photos: OutboxPhoto[] }) => void }) {
  const { text } = useTheme();
  const [body, setBody] = useState('');
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
    onSend({ body, photos });
    setBody('');
    setPhotos([]);
    setError(null);
  }

  return (
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
          <Text style={text('sectionHeading')}>📷</Text>
        </Pressable>
        <TextInput
          testID="coach-composer-input"
          accessibilityLabel="Message"
          placeholder="Write a message"
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
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[2], paddingHorizontal: space[4], paddingVertical: space[2.5], backgroundColor: palette.bg, borderTopWidth: 1, borderTopColor: palette.border },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: space[2] },
  photoButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, maxHeight: 132, minHeight: 44, backgroundColor: palette.surface, borderRadius: radius.input, paddingHorizontal: space[3.5], paddingTop: space[3], paddingBottom: space[3] },
  send: { minHeight: 44, minWidth: 64, paddingHorizontal: space[3.5], borderRadius: radius.button, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: white },
  disabled: { opacity: 0.4 },
  thumbs: { flexDirection: 'row', gap: space[2] },
  thumb: { width: 64, height: 64 },
  thumbImage: { width: 64, height: 64, borderRadius: radius.input, backgroundColor: palette.border },
  remove: { position: 'absolute', top: -6, right: -6, width: 24, height: 24, borderRadius: 12, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' },
  removeText: { color: white, lineHeight: 16 },
});
