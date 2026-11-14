/** Gap kept between a menu and the edge of what's visible. */
const EDGE = 8;

/**
 * Whether a menu that normally opens below its button should open above it instead: when it would run past the
 * bottom of what's visible (`visibleBottom`) and there is more room above the button (down to `visibleTop`).
 */
export function menuOpensUp(input: { buttonTop: number; buttonBottom: number; menuHeight: number; visibleTop: number; visibleBottom: number }): boolean {
  const { buttonTop, buttonBottom, menuHeight, visibleTop, visibleBottom } = input;
  const below = visibleBottom - EDGE - buttonBottom;
  const above = buttonTop - EDGE - visibleTop;
  return menuHeight > below && above > below;
}

/** Height of the iPhone's home-indicator area (0 elsewhere), from env(safe-area-inset-bottom). */
function safeAreaBottom(doc: Document): number {
  const probe = doc.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;bottom:0;width:0;height:env(safe-area-inset-bottom, 0px);visibility:hidden;pointer-events:none';
  doc.body.appendChild(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return height;
}

/**
 * For an open menu under `button`: true when it should flip above the button to stay on screen. Uses the visual
 * viewport (the part of the page left on screen when Safari's bars or the keyboard cover some of it) and keeps clear
 * of the home indicator and the phone's floating menu button.
 */
export function shouldOpenUp(button: HTMLElement, menu: HTMLElement): boolean {
  const doc = button.ownerDocument;
  const win = doc.defaultView;
  if (!win) return false;
  const vv = win.visualViewport;
  const top = vv ? vv.offsetTop : 0;
  const height = vv ? vv.height : win.innerHeight;
  const menuRoom = parseFloat(win.getComputedStyle(button).getPropertyValue('--coach-menu-room')) || 0;
  const b = button.getBoundingClientRect();
  return menuOpensUp({
    buttonTop: b.top,
    buttonBottom: b.bottom,
    menuHeight: menu.getBoundingClientRect().height,
    visibleTop: top,
    visibleBottom: top + height - Math.max(safeAreaBottom(doc), menuRoom),
  });
}
