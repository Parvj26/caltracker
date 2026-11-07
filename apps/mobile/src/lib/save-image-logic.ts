// The steps behind "Save image", kept free of native modules so they can be tested. save-image.ts plugs in the real
// photo library and view capture.

export type SaveImageResult = 'saved' | 'denied' | 'failed';

/** What the button says back: a toast when it worked, an alert (with a way to Settings when needed) when not. */
export const SAVE_MESSAGES: Record<SaveImageResult, string> = {
  saved: 'Saved to Photos',
  denied: 'CalTracker isn’t allowed to add photos. Turn on “Add Photos Only” for CalTracker in Settings to save cards.',
  failed: 'Couldn’t save the image. Try again.',
};

export type SaveImageDeps = {
  /** Asks (once) for add-only access to the photo library; true when granted. */
  requestAddPermission: () => Promise<boolean>;
  /** Draws the card to a temporary PNG and gives back its file URI. `fallback` uses the slower, safer renderer. */
  capture: (fallback: boolean) => Promise<string>;
  /** Adds the file to the photo library. */
  addToLibrary: (uri: string) => Promise<void>;
  /** Told about every failure, so it is never silent in development. */
  report?: (step: 'permission' | 'capture' | 'save', error: unknown) => void;
};

/**
 * Permission first (a "no" means Settings, not "try again"), then the picture, then the library. On iOS, drawing a
 * view that sits off screen can fail with the normal renderer, so a failed capture is retried once with the other one.
 */
export async function saveCard(deps: SaveImageDeps): Promise<SaveImageResult> {
  try {
    if (!(await deps.requestAddPermission())) return 'denied';
  } catch (e) {
    deps.report?.('permission', e);
    return 'failed';
  }
  let uri: string;
  try {
    uri = await deps.capture(false);
  } catch (first) {
    deps.report?.('capture', first);
    try {
      uri = await deps.capture(true);
    } catch (second) {
      deps.report?.('capture', second);
      return 'failed';
    }
  }
  try {
    await deps.addToLibrary(uri);
    return 'saved';
  } catch (e) {
    deps.report?.('save', e);
    return 'failed';
  }
}
