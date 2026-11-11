import { useLocalSearchParams, useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MAX_POST_PHOTOS, POST_BODY_MAX, PostInput, cardRequestLabel, parseCardRequest, type CommunityCard } from '@caltracker/shared';
import { CardView } from '@/components/community/parts';
import { Button, ErrorText, Screen, TextButton } from '@/components/ui';
import { createPost, previewCard } from '@/lib/community-api';
import { markWorkoutShared } from '@/lib/shared-workouts';
import { PhotoError, pickPhotos, preparePhoto, type PreparedPhoto } from '@/lib/community-photo';
import { useCommunity } from '@/lib/use-community';
import { useUnits } from '@/lib/use-units';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { useAnalyticsTask } from '@/lib/analytics/use-analytics-task';
import type { ShownError } from '@/lib/error-shown';

/**
 * Write a post: text (links work), up to 4 photos (shrunk on the phone first), and optionally a card shared from the
 * zoo book or a workout summary (`?card=` JSON: only which sticker or workout; the database builds the card).
 * `?photos=1` (the feed's photo button) opens the photo picker straight away. A failed post keeps everything and offers Retry; the post id stays
 * the same, so a retry never posts twice.
 */
export default function NewPostScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ card?: string; photos?: string }>();
  const { text, space, radius } = useTheme();
  const { community } = useCommunity();
  const card = useMemo(() => {
    try {
      return params.card ? parseCardRequest(JSON.parse(params.card)) : null;
    } catch {
      return null;
    }
  }, [params.card]);
  const units = useUnits();
  // The card exactly as it will post (the database builds it), shown as soon as it arrives; until then, or without
  // signal, a plain label.
  const [preview, setPreview] = useState<CommunityCard | null>(null);
  useEffect(() => {
    if (!card || !community) return;
    let alive = true;
    void previewCard(community.id, card).then((c) => alive && setPreview(c));
    return () => {
      alive = false;
    };
  }, [card, community]);
  const [postId] = useState(() => randomUUID());
  const [body, setBody] = useState('');
  const completePost = useAnalyticsTask('community_post');
  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<ShownError | null>(null);
  const [failed, setFailed] = useState(false);

  const addPhotos = async () => {
    setError(null);
    setPreparing(true);
    try {
      const picked = await pickPhotos(MAX_POST_PHOTOS - photos.length);
      const ready: PreparedPhoto[] = [];
      for (const p of picked) ready.push(await preparePhoto(p));
      setPhotos((prev) => [...prev, ...ready].slice(0, MAX_POST_PHOTOS));
    } catch (e) {
      setError(e instanceof PhotoError ? { code: 'photo_unusable', text: e.message } : { code: 'photos_open_failed' });
    } finally {
      setPreparing(false);
    }
  };

  // The feed's photo button: open the picker once, on arrival.
  const pickedOnArrival = useRef(false);
  useEffect(() => {
    if (params.photos !== '1' || pickedOnArrival.current) return;
    pickedOnArrival.current = true;
    void addPhotos();
  }, [params.photos]);

  const submit = async () => {
    setError(null);
    const parsed = PostInput.safeParse({ body, photoCount: photos.length, card });
    if (!parsed.success) {
      setError({ code: 'post_empty', text: parsed.error.issues[0]?.message });
      return;
    }
    if (!community) {
      setError({ code: 'community_not_member' });
      return;
    }
    setPosting(true);
    try {
      await createPost({ postId, community, body: body.trim(), card, photos });
      completePost();
      if (card?.kind === 'workout') markWorkoutShared(card.logId);
      router.back();
    } catch {
      setFailed(true);
      setError({ code: 'post_save_failed' });
    } finally {
      setPosting(false);
    }
  };

  return (
    <Screen>
      <View style={[styles.row, { gap: space[2] }]}>
        <TextButton title="Cancel" testID="new-post-cancel" onPress={() => router.back()} />
      </View>
      <Text style={text('screenTitle')} accessibilityRole="header">
        {card ? 'Share to community' : 'New post'}
      </Text>
      {card && preview && units ? (
        <View testID="community-card-preview">
          <CardView card={preview} units={units} authorName="You" />
        </View>
      ) : card ? (
        <View style={[styles.cardChip, { borderRadius: radius.card, padding: space[4] }]} testID="community-card-request">
          <Text style={text('sectionHeading')}>{cardRequestLabel(card)}</Text>
          <Text style={text('caption')}>Shown as a card with your stats once posted.</Text>
        </View>
      ) : null}
      <TextInput
        testID="new-post-body"
        accessibilityLabel="Post text"
        placeholder={card ? 'Add a caption (optional)' : 'What’s on your mind?'}
        placeholderTextColor={palette.inkMuted}
        multiline
        maxLength={POST_BODY_MAX}
        value={body}
        onChangeText={setBody}
        style={[text('body'), styles.input, { borderRadius: radius.input, padding: space[3.5], minHeight: 120 }]}
      />
      {photos.length > 0 ? (
        <View style={[styles.row, styles.wrap, { gap: space[2] }]}>
          {photos.map((p, i) => (
            <View key={p.id}>
              <Image source={{ uri: p.thumbUri }} style={[styles.thumb, { borderRadius: radius.input }]} accessibilityLabel={`Photo ${i + 1}`} />
              <Pressable
                testID={`remove-photo-${i}`}
                accessibilityRole="button"
                accessibilityLabel={`Remove photo ${i + 1}`}
                onPress={() => setPhotos((prev) => prev.filter((x) => x.id !== p.id))}
                style={({ pressed }) => [styles.remove, pressed && { opacity: pressedOpacity }]}
              >
                <Text style={[text('sectionHeading'), styles.removeText]}>×</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {photos.length < MAX_POST_PHOTOS ? (
        <Button
          variant="secondary"
          title={photos.length ? `Add photos (${photos.length}/${MAX_POST_PHOTOS})` : 'Add photos'}
          testID="new-post-photos"
          busy={preparing}
          onPress={() => void addPhotos()}
        />
      ) : null}
      {error ? <ErrorText testID="new-post-error" code={error.code}>{error.text}</ErrorText> : null}
      <Button title={failed ? 'Retry' : 'Post'} testID="new-post-submit" busy={posting} disabled={preparing} onPress={() => void submit()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexWrap: 'wrap' },
  input: { borderWidth: 2, borderColor: palette.border, textAlignVertical: 'top', color: palette.ink },
  thumb: { width: 80, height: 80 },
  cardChip: { backgroundColor: palette.lime },
  remove: { position: 'absolute', top: 0, right: 0, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  removeText: { color: palette.bg, textShadowColor: palette.ink, textShadowRadius: 4 },
});
