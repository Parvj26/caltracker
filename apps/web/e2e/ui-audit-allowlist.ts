// Known issues the UI audit (ui-audit.spec.ts) lets through today. Every entry is a screen that has not moved to the
// UI rulebook yet (docs/design/ui-audit.md). The list must only shrink: when a screen is fixed, delete its entries.
// Never add an entry to make a new screen pass; fix the screen instead.
//
// selector: a CSS selector the offending element matches (el.matches). CSS module classes are hashed in the build
// ("TmEZKq_navItem"), so match them with [class*="_navItem"]. No selector = the whole page (hscroll, logo, heading).
// pages: page names from GROUPS in ui-audit.spec.ts, or '*' for every page. sizes: leave out for all three.

export type Size = 'phone' | 'tablet' | 'desktop';
export type UiRule = 'hscroll' | 'target' | 'text' | 'overlap' | 'logo' | 'heading';

export type UiAllow = { rule: UiRule; pages: string[] | '*'; sizes?: Size[]; selector?: string; reason: string };
export type AxeAllow = { rule: string; pages: string[] | '*'; sizes?: Size[]; selector?: string; reason: string };

const TODO = 'TODO standards migration';

export const UI_ALLOW: UiAllow[] = [
  {
    rule: 'logo',
    pages: '*',
    sizes: ['phone'],
    reason: `The phone layout hides the sidebar and has no header, so coach pages show no logo. ${TODO}`,
  },
];

// All of these are "serious" except aria-required-children ("critical").
export const AXE_ALLOW: AxeAllow[] = [
  {
    rule: 'label-content-name-mismatch',
    pages: '*',
    selector: '[class*="_navItem"], [class*="_tab"]',
    reason: `Sidebar and tab bar items (Messages, Profile): the aria-label doesn't contain the visible text (badge / avatar initials). ${TODO}`,
  },
  {
    rule: 'label-content-name-mismatch',
    pages: ['Exercises'],
    selector: '[role=option]',
    reason: `Exercise search results: the option's aria-label differs from its visible text. ${TODO}`,
  },
  {
    rule: 'aria-required-children',
    pages: ['Exercises'],
    sizes: ['desktop'],
    selector: '[role=listbox]',
    reason: `Exercise search results listbox contains children that are not options. ${TODO}`,
  },
  {
    rule: 'label-content-name-mismatch',
    pages: ['Workout builder'],
    selector: '[class*="_phoneRow"]',
    reason: `Builder exercise rows: the aria-label doesn't contain the visible sets summary. ${TODO}`,
  },
  {
    rule: 'label-content-name-mismatch',
    pages: ['Client overview'],
    selector: '[aria-label="Set a goal"]',
    reason: `"Set goal" button is labelled "Set a goal". ${TODO}`,
  },
  {
    rule: 'definition-list',
    pages: ['Client overview'],
    selector: 'dl[class*="_stats"]',
    reason: `Overview stats <dl> holds elements other than dt/dd groups. ${TODO}`,
  },
  {
    rule: 'label-content-name-mismatch',
    pages: ['Client training'],
    selector: '[class*="_choice"]',
    reason: `Training tab "Assign" / "Add" choices: the label doesn't contain the visible text. ${TODO}`,
  },
  {
    rule: 'scrollable-region-focusable',
    pages: ['Client training'],
    sizes: ['phone'],
    selector: '[class*="_scroll"]',
    reason: `Calendar's sideways-scrolling strip can't be reached with the keyboard. ${TODO}`,
  },
];
