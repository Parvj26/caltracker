import { STICKERS } from '../awards/catalogue';
import { animalAmount } from '../awards/ladder';
import { formatTotalWeight, formatWeight, type Units } from '../units/units';
import type { CardPr, CardRequest, CommunityCard } from './schema';

export type CardText = {
  /** A small label above the headline ("Rare find!", "Shiny!"), or null when the headline says it all */
  badge: string | null;
  /** The headline: a sentence about the poster ("Vaishali lifted 1,540 lb — about as much as 1 cow 🐄") */
  title: string;
  /** Smaller lines under it (the workout's name, "11 exercises · 10 sets", more PRs) */
  lines: string[];
  /** The sticker to draw, if any */
  stickerKey: string | null;
  shiny: boolean;
};

type WorkoutCard = Extract<CommunityCard, { kind: 'workout' }>;

const PR_KIND_LABEL: Record<CardPr['prKind'], string> = {
  heaviest: 'heaviest',
  reps_at_weight: 'most reps',
  e1rm: 'best estimated max',
};

/** An emoji for each ladder animal that has one, to end the sentence ("… about as much as 1 cow 🐄"). */
const ANIMAL_EMOJI: Record<string, string> = {
  rabbit: '🐇',
  cat: '🐈',
  koala: '🐨',
  corgi: '🐕',
  'emperor-penguin': '🐧',
  'golden-retriever': '🐕',
  'snow-leopard': '🐆',
  goat: '🐐',
  sheep: '🐑',
  kangaroo: '🦘',
  'giant-panda': '🐼',
  pig: '🐖',
  gorilla: '🦍',
  lion: '🦁',
  'polar-bear': '🐻‍❄️',
  horse: '🐎',
  moose: '🫎',
  cow: '🐄',
  bison: '🦬',
  giraffe: '🦒',
  hippo: '🦛',
  rhino: '🦏',
  elephant: '🐘',
  orca: '🐋',
  'whale-shark': '🦈',
  'humpback-whale': '🐋',
  'blue-whale': '🐳',
};

const withEmoji = (text: string, key: string | null): string => {
  const emoji = key ? ANIMAL_EMOJI[key] : undefined;
  return emoji ? `${text} ${emoji}` : text;
};

const stickerName = (key: string): string => STICKERS.find((s) => s.key === key)?.name ?? key;

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

function stickerBadge(key: string, shiny: boolean): string {
  if (shiny) return 'Shiny!';
  const kind = STICKERS.find((s) => s.key === key)?.kind;
  if (kind === 'rare') return 'Rare find!';
  if (kind === 'drop') return 'Ultra-rare!';
  if (kind === 'landmark') return 'Landmark reached';
  return 'New sticker';
}

/**
 * Who the sentence is about: the first word of the poster's display name ("Vaishali" from "Vaishali Kapoor").
 * "You" stays "You" (the card preview before posting), and a name that no longer resolves reads "A former member".
 */
export function posterFirstName(displayName: string): string {
  const name = displayName.trim();
  if (!name || name === 'Former member') return 'A former member';
  return name.split(/\s+/)[0]!;
}

/** "Bench Press · 100 kg × 5 (most reps)", in the reader's units. */
export function prLine(pr: CardPr, units: Units): string {
  return `${pr.exerciseName} · ${prAmount(pr, units)} (${PR_KIND_LABEL[pr.prKind]})`;
}

function prAmount(pr: CardPr, units: Units): string {
  const weight = formatWeight(pr.valueKg, units);
  return pr.reps !== null && pr.prKind === 'reps_at_weight' ? `${weight} × ${pr.reps}` : weight;
}

/** "Bench Press 60 lb × 8", "Squat 100 kg", "Deadlift 140 kg estimated max": a PR inside a sentence. */
function prPhrase(pr: CardPr, units: Units): string {
  const amount = prAmount(pr, units);
  return pr.prKind === 'e1rm' ? `${pr.exerciseName} ${amount} estimated max` : `${pr.exerciseName} ${amount}`;
}

/**
 * The headline of a workout card, in the reader's units: "Vaishali lifted 1,540 lb — about as much as 1 cow 🐄".
 * Without an animal, just what was lifted. Null when the card has no volume (built before volumes were stored, or a
 * workout with nothing weighed): those keep the older card with the workout's name as the headline.
 */
export function workoutCardSentence(card: WorkoutCard, units: Units, posterName: string): string | null {
  if (card.volumeKg === null || card.volumeKg === undefined || card.volumeKg <= 0) return null;
  const lifted = `${posterFirstName(posterName)} lifted ${formatTotalWeight(card.volumeKg, units)}`;
  if (!card.stickerKey || !card.multiple) return lifted;
  const a = animalAmount(card.multiple, stickerName(card.stickerKey));
  const animals = `${a.count} ${a.noun.toLowerCase()}`;
  return withEmoji(`${lifted} — ${a.tiny ? `less than ${animals}` : `about as much as ${animals}`}`, card.stickerKey);
}

/** The words on a shared card, in the reader's own units, about the poster (their display name). */
export function cardText(card: CommunityCard, units: Units, posterName: string): CardText {
  const who = posterFirstName(posterName);
  switch (card.kind) {
    case 'sticker': {
      const name = stickerName(card.stickerKey);
      return {
        badge: stickerBadge(card.stickerKey, card.shiny),
        title: card.shiny
          ? `${who} earned a shiny ${name} sticker ✨`
          : withEmoji(`${who} earned the ${name} sticker`, card.stickerKey),
        lines: [],
        stickerKey: card.stickerKey,
        shiny: card.shiny,
      };
    }
    case 'workout': {
      const counts = `${plural(card.exerciseCount, 'exercise')} · ${plural(card.setCount, 'set')}`;
      const name = card.workoutName || 'Workout';
      const sentence = workoutCardSentence(card, units, posterName);
      if (sentence) return { badge: null, title: sentence, lines: [name, counts], stickerKey: card.stickerKey, shiny: card.shiny };
      // No volume stored with this card: the older style, without the weight.
      const lines = [counts];
      if (card.stickerKey && card.multiple) {
        const a = animalAmount(card.multiple, stickerName(card.stickerKey));
        lines.push(`${a.tiny ? '<' : '≈'} ${a.count} ${a.noun}`);
      }
      return { badge: 'Workout done', title: name, lines, stickerKey: card.stickerKey, shiny: card.shiny };
    }
    case 'pr': {
      const [first, ...rest] = card.prs;
      const n = card.prs.length;
      const lead = first ? prPhrase(first, units) : '';
      const title = n === 1 ? `${who} set a new PR: ${lead}` : `${who} set ${n} new PRs: ${lead} and ${n - 1} more`;
      return {
        badge: null,
        title,
        lines: [...rest.map((p) => prLine(p, units)), card.workoutName],
        stickerKey: null,
        shiny: false,
      };
    }
  }
}

/** What the composer shows for a card while its preview loads, or without signal (the database builds the real card). */
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
