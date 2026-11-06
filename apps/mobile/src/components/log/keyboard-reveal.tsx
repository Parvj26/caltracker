import { createContext, useContext, useEffect, useRef, type ComponentRef, type ReactNode, type RefObject } from 'react';
import { Keyboard, ScrollView, useWindowDimensions, type ScrollViewProps, type View } from 'react-native';
import { space } from '@/theme/theme';

/** Scrolls the page that holds a component down by `dy` points. */
const ScrollBy = createContext<((dy: number) => void) | null>(null);

/**
 * One logging page's vertical ScrollView. It makes room for the keyboard itself (automaticallyAdjustKeyboardInsets)
 * and lets a child ask to be scrolled into view above it (useKeepAboveKeyboard).
 */
export function PageScroll({ children, ...props }: ScrollViewProps & { children: ReactNode }) {
  const ref = useRef<ComponentRef<typeof ScrollView>>(null);
  const offset = useRef(0);
  // Not animated: RN takes the next tap on a scroll view it thinks is still moving, and would eat the Done tap.
  const scrollBy = (dy: number) => ref.current?.scrollTo({ y: Math.max(0, offset.current + dy), animated: false });
  return (
    <ScrollBy.Provider value={scrollBy}>
      <ScrollView
        {...props}
        ref={ref}
        automaticallyAdjustKeyboardInsets
        scrollEventThrottle={16}
        onScroll={(e) => {
          offset.current = e.nativeEvent.contentOffset.y;
          props.onScroll?.(e);
        }}
      >
        {children}
      </ScrollView>
    </ScrollBy.Provider>
  );
}

/**
 * While a number is being typed, keeps `target` (the Done button) above the keyboard, so Done can be pressed without
 * closing the keyboard first. Only the page on screen moves; pages beside it are off to the side.
 */
export function useKeepAboveKeyboard(target: RefObject<ComponentRef<typeof View> | null>): void {
  const scrollBy = useContext(ScrollBy);
  const { width } = useWindowDimensions();
  useEffect(() => {
    if (!scrollBy) return;
    const sub = Keyboard.addListener('keyboardWillShow', (e) => {
      target.current?.measureInWindow((x, y, _w, h) => {
        if (x < 0 || x >= width) return;
        const overlap = y + h + space[2] - e.endCoordinates.screenY;
        if (overlap > 0) scrollBy(overlap);
      });
    });
    return () => sub.remove();
  }, [scrollBy, target, width]);
}
