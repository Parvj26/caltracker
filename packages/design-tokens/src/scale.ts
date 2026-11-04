/** 4-pt grid: keys are multiples of 4 (key n -> n * 4 px). */
export const space = { 1: 4, 2: 8, 2.5: 10, 3: 12, 3.5: 14, 4: 16, 4.5: 18, 6: 24 } as const;

export const radius = { input: 12, button: 16, card: 20, pill: 999 } as const;
export const borderWidth = { card: 2, secondaryButton: 1.5 } as const;
export const buttonBase = 4;
export const pressDepth = 2;

export const shadow = { sticker: '0 2px 6px rgba(0,0,0,.2)' } as const;
export const stickerRing = 3;

export const tapTarget = { min: 44, logging: 54 } as const;
export const buttonMinHeight = { phone: 48, tablet: 52, web: 48 } as const;
export const breakpoints = { tablet: 600, split: 1000, webSidebarCollapse: 900 } as const;
