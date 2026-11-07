import { STICKERS } from '../awards/catalogue';
import { formatMultiple } from '../awards/ladder';
import { formatWeight, type Units } from '../units/units';
import type { CardPr, CardRequest, CommunityCard } from './schema';

export type CardText = {
  /** The tier banner ("Rare find!", "Shiny!", "New PR!", "Workout done") */
  badge: string;
  /** The big line ("Okapi", the workout's name, "Bench Press · 100 kg × 5") */
  title: string;
  /** Smaller lines under it ("4 exercises · 12 sets", "≈ 2 Giraffes", more PRs, the workout name) */
  lines: string[];
  /** The sticker to draw, if any */
  stickerKey: string | null;
  shiny: boolean;
};

const PR_KIND_LABEL: Record<CardPr['prKind'], string> = {
  heaviest: 'heaviest',
  reps_at_weight: 'most reps',
  e1rm: 'best estimated max',
};

const stickerName = (key: string): string => STICKERS.find((s) => s.key === key)?.name ?? key;

function stickerBadge(key: string, shiny: boolean): string {
  if (shiny) return 'Shiny!';
  const kind = STICKERS.find((s) => s.key === key)?.kind;
  if (kind === 'rare') return 'Rare find!';
  if (kind === 'drop') return 'Ultra-rare!';
  if (kind === 'landmark') return 'Landmark reached';
  return 'New sticker';
}

/** "Bench Press · 100 kg × 5 (most reps)", in the reader's units. */
export function prLine(pr: CardPr, units: Units): string {
  const weight = formatWeight(pr.valueKg, units);
  const amount = pr.reps !== null && pr.prKind === 'reps_at_weight' ? `${weight} × ${pr.reps}` : weight;
  return `${pr.exerciseName} · ${amount} (${PR_KIND_LABEL[pr.prKind]})`;
}

/** The words on a shared card, in the reader's own units. */
export function cardText(card: CommunityCard, units: Units): CardText {
  switch (card.kind) {
    case 'sticker':
      return {
        badge: stickerBadge(card.stickerKey, card.shiny),
        title: card.shiny ? `✦ Shiny ${stickerName(card.stickerKey)}` : stickerName(card.stickerKey),
        lines: [],
        stickerKey: card.stickerKey,
        shiny: card.shiny,
      };
    case 'workout': {
      const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
      const lines = [`${plural(card.exerciseCount, 'exercise')} · ${plural(card.setCount, 'set')}`];
      if (card.stickerKey && card.multiple) lines.push(formatMultiple(card.multiple, stickerName(card.stickerKey)));
      return { badge: 'Workout done', title: card.workoutName || 'Workout', lines, stickerKey: card.stickerKey, shiny: card.shiny };
    }
    case 'pr': {
      const [first, ...rest] = card.prs.map((p) => prLine(p, units));
      return {
        badge: card.prs.length > 1 ? `${card.prs.length} new PRs!` : 'New PR!',
        title: first ?? card.workoutName,
        lines: [...rest, card.workoutName],
        stickerKey: null,
        shiny: false,
      };
    }
  }
}

/** What the composer shows for a card before it is posted (the database builds the real card). */
export function cardRequestLabel(req: CardRequest): string {
  switch (req.kind) {
    case 'sticker':
      return `Your ${stickerName(req.stickerKey)} sticker`;
    case 'workout':
      return 'Your workout card';
    case 'pr':
      return 'Your personal bests';
  }
}
