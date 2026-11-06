export const MIN_CHOICE_OPTIONS = 2;
export const MAX_CHOICE_OPTIONS = 5;
export const SECTION_PRESETS = ['Warm-Up', 'Core', 'Main', 'Finisher', 'Cool-down'] as const;

export type SectionRun = {
  section: { id: string; name: string } | null;
  blockIndexes: number[];
};

type SectionLike = { id: string; name: string };

/** Consecutive blocks with the same section form one run. Unknown section ids count as unsectioned. */
export function sectionRuns(
  blocks: ReadonlyArray<{ sectionId: string | null }>,
  sections: ReadonlyArray<SectionLike>,
): SectionRun[] {
  const runs: SectionRun[] = [];
  blocks.forEach((block, index) => {
    const section = sections.find((s) => s.id === block.sectionId) ?? null;
    const last = runs[runs.length - 1];
    if (last && (last.section?.id ?? null) === (section?.id ?? null)) {
      last.blockIndexes.push(index);
    } else {
      runs.push({
        section: section ? { id: section.id, name: section.name } : null,
        blockIndexes: [index],
      });
    }
  });
  return runs;
}

/** 1-based position of a block inside its section's run, or null when it has no section. */
export function sectionPlace(
  blocks: ReadonlyArray<{ sectionId: string | null }>,
  sections: ReadonlyArray<SectionLike>,
  blockIndex: number,
): { name: string; at: number; of: number } | null {
  const run = sectionRuns(blocks, sections).find((r) => r.blockIndexes.includes(blockIndex));
  if (!run || !run.section) return null;
  return {
    name: run.section.name,
    at: run.blockIndexes.indexOf(blockIndex) + 1,
    of: run.blockIndexes.length,
  };
}
