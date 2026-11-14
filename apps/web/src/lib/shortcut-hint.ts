/** What the browser tells us about the device, for the keyboard-shortcut hint. */
export type HintDevice = {
  /** navigator.userAgentData.platform or navigator.platform ("MacIntel", "Win32", "iPhone"). */
  platform: string;
  /** matchMedia('(hover: hover) and (pointer: fine)'): the main pointer is a mouse or trackpad. */
  finePointer: boolean;
  maxTouchPoints: number;
};

/**
 * The "⌘K" / "Ctrl K" hint in a search box, or '' where there is (most likely) no keyboard to press it on: touch-first
 * devices, iPhones and iPads. iPadOS Safari calls itself a Mac, so a "Mac" with touch points counts as an iPad.
 */
export function shortcutHint({ platform, finePointer, maxTouchPoints }: HintDevice): string {
  if (!finePointer || /iphone|ipad|ipod/i.test(platform)) return '';
  if (/mac/i.test(platform)) return maxTouchPoints > 1 ? '' : '⌘K';
  return 'Ctrl K';
}
