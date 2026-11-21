// The welcome on a fresh open (approved Welcome board): the splash's logo stays put, "Welcome back, Parv" fades in
// under it while Today's first load is pending, then it all fades into Today. It never adds waiting: it leaves the
// moment Today is ready (welcome-gate), or at once when there is no Today to wait for (signed out, no coach).
import { useEffect, useRef, useState } from 'react';
import { AppState, Animated, Image, StyleSheet, Text } from 'react-native';
import { useReduceMotion } from '@/components/ui/button';
import { useSession } from '@/lib/session';
import { readCachedFirstName, readCachedFirstTime } from '@/lib/today-api';
import { welcomeGate, useWelcomeState } from '@/lib/welcome-gate';
import { WELCOME_FADE_MS, WELCOME_MAX_MS, WELCOME_NAME_FADE_MS, welcomeText, type WelcomeText } from '@/lib/welcome-logic';
import { fontFamilyFor } from '@/theme/fonts';
import { palette } from '@/theme/theme';
// The native splash's own image at its own size (app.json: expo-splash-screen, imageWidth 120), so the hand-over is seamless.
import splashIcon from '../../assets/images/splash-icon.png';

const LOGO = 120;
/** How far the logo rises to make room for the name (none with Reduce Motion: a cross-fade only). */
const LIFT = 36;
const NAME_GAP = 22;
/** Fading back in after a long time away (the phone shows its snapshot of the last screen first). */
const RESUME_FADE_IN_MS = 150;

export function WelcomeOverlay() {
  const { loading, session, workspace } = useSession();
  const { showing, opens } = useWelcomeState();
  const reduceMotion = useReduceMotion();
  const userId = session?.user.id ?? null;
  const [mounted, setMounted] = useState(showing);
  const [words, setWords] = useState<WelcomeText | null>(null);
  // VoiceOver hears the welcome only once the saved name has been read, so it never announces a placeholder first.
  const [nameRead, setNameRead] = useState(false);
  const opacity = useRef(new Animated.Value(1)).current;
  const nameIn = useRef(new Animated.Value(0)).current;

  // A fresh open is a cold start (the store starts showing) or coming back after more than 10 minutes away.
  useEffect(() => {
    let away: number | null = null;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') away = Date.now();
      else if (s === 'active') {
        welcomeGate.resumed(away, Date.now());
        away = null;
      }
    });
    return () => sub.remove();
  }, []);

  // Signed out, or signed in without a coach: Today never loads, so there is nothing to wait for.
  useEffect(() => {
    if (showing && !loading && (session === null || workspace === null)) welcomeGate.noToday();
  }, [showing, loading, session, workspace]);

  // Only a ceiling, never a wait: if Today's signal never comes (a deep link elsewhere), the app is not stuck behind it.
  useEffect(() => {
    if (!showing) return;
    const t = setTimeout(welcomeGate.timedOut, WELCOME_MAX_MS);
    return () => clearTimeout(t);
  }, [showing, opens]);

  // The name saved on the phone (Today saves it on each load); without one, just the logo.
  useEffect(() => {
    if (!showing || !userId) return;
    let alive = true;
    void Promise.all([readCachedFirstName(userId), readCachedFirstTime(userId)]).then(
      ([name, firstTime]) => {
        if (!alive) return;
        setWords(welcomeText(name, firstTime));
        setNameRead(true);
      },
      () => alive && setNameRead(true),
    );
    return () => {
      alive = false;
    };
  }, [showing, userId]);

  useEffect(() => {
    if (words) Animated.timing(nameIn, { toValue: 1, duration: WELCOME_NAME_FADE_MS, useNativeDriver: true }).start();
  }, [words, nameIn]);

  useEffect(() => {
    if (showing) {
      setMounted(true);
      if (opens === 0) opacity.setValue(1);
      else {
        opacity.setValue(0);
        Animated.timing(opacity, { toValue: 1, duration: RESUME_FADE_IN_MS, useNativeDriver: true }).start();
      }
      return;
    }
    const fade = Animated.timing(opacity, { toValue: 0, duration: WELCOME_FADE_MS, useNativeDriver: true });
    fade.start(({ finished }) => {
      if (!finished) return;
      setMounted(false);
      setWords(null);
      setNameRead(false);
      nameIn.setValue(0);
    });
    return () => fade.stop();
  }, [showing, opens, opacity, nameIn]);

  if (!mounted) return null;
  const lift = reduceMotion ? 0 : -LIFT;
  const rise = { transform: [{ translateY: nameIn.interpolate({ inputRange: [0, 1], outputRange: [0, lift] }) }] };
  return (
    <Animated.View
      testID="welcome-overlay"
      pointerEvents={showing ? 'auto' : 'none'}
      // Only while showing: during the fade VoiceOver is free to move on to Today.
      accessible={showing && nameRead}
      accessibilityViewIsModal={showing}
      accessibilityElementsHidden={!showing}
      accessibilityLabel={showing && nameRead ? (words?.accessibilityLabel ?? 'CalTracker') : undefined}
      style={[StyleSheet.absoluteFill, styles.cover, { opacity }]}
    >
      <Animated.View style={[styles.logo, rise]}>
        <Image source={splashIcon} style={styles.logo} />
      </Animated.View>
      {words ? (
        <Animated.View style={[styles.words, { opacity: nameIn }, rise]}>
          <Text style={styles.lead} maxFontSizeMultiplier={1.6}>
            {words.lead}
          </Text>
          <Text style={styles.name} maxFontSizeMultiplier={1.6}>
            {words.name}
          </Text>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cover: { backgroundColor: palette.bg, alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  logo: { width: LOGO, height: LOGO },
  // Under the logo at the screen's centre (the logo itself never moves off the splash's spot until the name arrives).
  words: { position: 'absolute', top: '50%', left: 0, right: 0, marginTop: LOGO / 2 + NAME_GAP, paddingHorizontal: 24, alignItems: 'center' },
  lead: { fontFamily: fontFamilyFor('sans', 700), fontSize: 20, color: palette.inkMuted, textAlign: 'center' },
  name: { fontFamily: fontFamilyFor('sans', 800), fontSize: 36, color: palette.ink, textAlign: 'center' },
});
