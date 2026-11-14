type Clipboard = Pick<globalThis.Clipboard, 'writeText'>;
type Doc = Pick<Document, 'createElement' | 'body' | 'execCommand'>;

/**
 * Copies text to the clipboard. The clipboard API first; where it is missing or refuses (an older browser, a page that
 * isn't https), a hidden text box and the old copy command. Returns whether the text was copied.
 */
export async function copyText(text: string, env: { clipboard: Clipboard | undefined; document: Doc }): Promise<boolean> {
  if (env.clipboard) {
    try {
      await env.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the text box.
    }
  }
  const area = env.document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  // Off screen, and 16 px so iOS Safari doesn't zoom in on it.
  Object.assign(area.style, { position: 'fixed', top: '0', left: '-9999px', fontSize: '16px' });
  env.document.body.appendChild(area);
  try {
    area.select();
    return env.document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
