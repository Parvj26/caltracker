import * as Application from 'expo-application';
import type { ReactNode } from 'react';
import { Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { useReduceMotion } from '@/components/ui/button';
import { UPDATE_GATE_COPY, UPDATE_STEPS, updateFooter, type GateConfig } from '@/lib/update-gate';
import { useUpdateGate } from '@/lib/use-update-gate';
import { fontFamilyFor } from '@/theme/fonts';
import { contentMaxWidth, palette, pressedOpacity, white } from '@/theme/theme';
// The app's own mark (generated from packages/design-tokens/assets/logo-mark.svg).
import logoMark from '../../assets/images/logo-mark.png';

// The required "update the app" screen, from the approved update-canvas board (Main.dc.html, 390 x 844).
// It replaces the whole app, signed in or out, and has no way to dismiss it: the only way on is to update.

const hidden = { accessibilityElementsHidden: true, importantForAccessibility: 'no' } as const;
const MAX_SCALE = 1.4;

/** Renders the app, or the update screen when this build is below the minimum. A failed check never blocks. */
export function UpdateGate({ children }: { children: ReactNode }) {
  const { status, config } = useUpdateGate();
  if (status === 'required' && config) return <UpdateGateScreen config={config} />;
  return <>{children}</>;
}

async function openUpdate(url: string) {
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('Open TestFlight', `Open ${url} on this phone to update CalTracker.`);
  }
}

export function UpdateGateScreen({ config }: { config: GateConfig }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const footer = updateFooter(Application.nativeApplicationVersion, Application.nativeBuildVersion, config.latestBuild);
  return (
    <View style={styles.screen} testID="update-gate">
      <Backdrop width={width} />
      <ScrollView
        bounces={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(32, insets.bottom + 12) }]}
      >
        <View style={styles.column}>
          <AppMark />
          <Text style={[styles.eyebrow, styles.eyebrowGap]} maxFontSizeMultiplier={MAX_SCALE}>
            {UPDATE_GATE_COPY.eyebrow}
          </Text>
          <Text style={styles.headline} accessibilityRole="header" maxFontSizeMultiplier={MAX_SCALE}>
            {UPDATE_GATE_COPY.headline}
          </Text>
          <Text style={styles.body} maxFontSizeMultiplier={MAX_SCALE}>
            {UPDATE_GATE_COPY.body}
          </Text>
          <View style={styles.card}>
            {UPDATE_STEPS.map((step, i) => (
              <View key={step.title} style={styles.step} accessible accessibilityLabel={`Step ${i + 1}: ${step.title}. ${step.detail}`}>
                <View style={styles.stepNumber}>
                  <Text style={styles.stepNumberText} maxFontSizeMultiplier={MAX_SCALE}>
                    {i + 1}
                  </Text>
                </View>
                <View style={styles.stepText}>
                  <Text style={styles.stepTitle} maxFontSizeMultiplier={MAX_SCALE}>
                    {step.title}
                  </Text>
                  <Text style={styles.stepDetail} maxFontSizeMultiplier={MAX_SCALE}>
                    {step.detail}
                  </Text>
                </View>
              </View>
            ))}
          </View>
          <View style={styles.spacer} />
          <OpenButton onPress={() => void openUpdate(config.updateUrl)} />
          <Text style={styles.footer} maxFontSizeMultiplier={MAX_SCALE}>
            {footer}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

/** The soft blue curve across the top (a 470 pt tall shape, 60 pt wider each side, with a half-ellipse bottom,
 *  lifted 140 pt) and its three dots. */
function Backdrop({ width }: { width: number }) {
  const w = width + 120;
  const rx = w / 2;
  const ry = 235;
  const top = -140;
  const straightEnd = top + 470 - ry;
  const d = `M -60 ${top} H ${width + 60} V ${straightEnd} A ${rx} ${ry} 0 0 1 -60 ${straightEnd} Z`;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" {...hidden}>
      <Svg width={width} height={top + 470}>
        <Path d={d} fill={palette.drop} />
      </Svg>
      <View style={[styles.dot, { right: 34, top: 86, width: 18, height: 18, backgroundColor: palette.blue }]} />
      <View style={[styles.dot, { left: 40, top: 150, width: 10, height: 10, backgroundColor: palette.magenta, opacity: 0.35 }]} />
      <View
        style={[
          styles.dot,
          { right: 70, top: 250, width: 12, height: 12, backgroundColor: palette.lime, borderWidth: 2, borderColor: palette.ink },
        ]}
      />
    </View>
  );
}

/** The lime app mark on a hard ink shadow, with the blue download badge. */
function AppMark() {
  return (
    <View style={styles.mark} accessible accessibilityRole="image" accessibilityLabel="CalTracker update">
      <View style={styles.markShadow} />
      <View style={styles.markFace}>
        <Image source={logoMark} style={styles.markImage} />
      </View>
      <View style={styles.badge}>
        <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={white} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" {...hidden}>
          <Path d="M12 5v11" />
          <Path d="M7 11l5 5 5-5" />
        </Svg>
      </View>
    </View>
  );
}

/** The big black button on a lime base. Sinks when pressed (fades instead with Reduce Motion). */
function OpenButton({ onPress }: { onPress: () => void }) {
  const reduceMotion = useReduceMotion();
  return (
    <Pressable testID="update-gate-open" onPress={onPress} accessibilityRole="button" accessibilityLabel={UPDATE_GATE_COPY.button} style={styles.buttonWrap}>
      {({ pressed }) => (
        <>
          <View style={styles.buttonBase} />
          <View
            style={[
              styles.buttonFace,
              pressed && (reduceMotion ? { opacity: pressedOpacity } : { transform: [{ translateY: BUTTON_BASE }] }),
            ]}
          >
            <Text style={styles.buttonText} maxFontSizeMultiplier={MAX_SCALE}>
              {UPDATE_GATE_COPY.button}
            </Text>
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={white} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" {...hidden}>
              <Path d="M5 12h14" />
              <Path d="M13 6l6 6-6 6" />
            </Svg>
          </View>
        </>
      )}
    </Pressable>
  );
}

const MARK = 112;
const MARK_BORDER = 3;
const MARK_SHADOW = 6;
const MARK_RADIUS = 32;
const BUTTON_HEIGHT = 58;
const BUTTON_BASE = 5;
const BUTTON_RADIUS = 18;

const sans = (weight: 500 | 700 | 800) => ({ fontFamily: fontFamilyFor('sans', weight) });

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  scroll: { flexGrow: 1, paddingTop: 96, paddingHorizontal: 24 },
  column: { flex: 1, width: '100%', maxWidth: contentMaxWidth, alignSelf: 'center', alignItems: 'center', gap: 18 },
  dot: { position: 'absolute', borderRadius: 999 },

  mark: { width: MARK, height: MARK },
  markShadow: { position: 'absolute', left: 0, right: 0, top: MARK_SHADOW, height: MARK, borderRadius: MARK_RADIUS, backgroundColor: palette.ink },
  markFace: {
    width: MARK,
    height: MARK,
    borderRadius: MARK_RADIUS,
    borderWidth: MARK_BORDER,
    borderColor: palette.ink,
    backgroundColor: palette.lime,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  markImage: { width: MARK - MARK_BORDER * 2, height: MARK - MARK_BORDER * 2 },
  badge: {
    position: 'absolute',
    right: -12,
    bottom: -12,
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: palette.magenta,
    borderWidth: 3,
    borderColor: white,
    alignItems: 'center',
    justifyContent: 'center',
  },

  eyebrow: { ...sans(800), fontSize: 13, letterSpacing: 1.04, color: palette.magentaDeep, textAlign: 'center' },
  eyebrowGap: { marginTop: 10 },
  headline: { ...sans(800), fontSize: 32, lineHeight: 35, color: palette.ink, textAlign: 'center' },
  body: { ...sans(500), fontSize: 16, lineHeight: 24, color: palette.inkMuted, textAlign: 'center', maxWidth: 300 },

  card: {
    alignSelf: 'stretch',
    marginTop: 6,
    padding: 18,
    gap: 14,
    borderWidth: 2,
    borderColor: palette.border,
    borderRadius: 22,
    backgroundColor: palette.bg,
  },
  step: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepNumber: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: palette.lime,
    borderWidth: 2,
    borderColor: palette.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: { ...sans(800), fontSize: 16, color: palette.ink },
  stepText: { flex: 1, gap: 2 },
  stepTitle: { ...sans(800), fontSize: 16, color: palette.ink },
  stepDetail: { ...sans(500), fontSize: 14, color: palette.inkMuted },

  spacer: { flex: 1 },
  buttonWrap: { alignSelf: 'stretch', paddingBottom: BUTTON_BASE },
  buttonBase: { position: 'absolute', left: 0, right: 0, bottom: 0, top: BUTTON_BASE, borderRadius: BUTTON_RADIUS, backgroundColor: palette.lime },
  buttonFace: {
    minHeight: BUTTON_HEIGHT,
    borderRadius: BUTTON_RADIUS,
    backgroundColor: palette.ink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 24,
  },
  buttonText: { ...sans(800), fontSize: 18, color: white },
  // Bricolage ships 500/700/800 only; the board's 600 footer uses 700.
  footer: { ...sans(700), fontSize: 13, color: palette.inkMuted, textAlign: 'center' },
});
