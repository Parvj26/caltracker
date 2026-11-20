import { MenuSheet } from '@/components/ui/menu-sheet';

export type MenuItem = { title: string; testID: string; onPress: () => void; destructive?: boolean };

/** The logger's and the summary's ⋯ menus: the app's one menu sheet (see MenuSheet). */
export function ActionMenu({
  title,
  items,
  onClose,
}: {
  /** Null hides the menu. */
  title: string | null;
  items: MenuItem[];
  onClose: () => void;
}) {
  return <MenuSheet title={title} items={items.map((i) => ({ label: i.title, testID: i.testID, onPress: i.onPress, destructive: i.destructive }))} onClose={onClose} />;
}
