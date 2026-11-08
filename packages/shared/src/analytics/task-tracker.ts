import type { AnalyticsProps, EventName, TaskName } from './events';

export type Emit = (event: EventName, props: AnalyticsProps) => void;

/** A task left in the background longer than this is counted as abandoned. */
export const ABANDON_AFTER_MS = 10 * 60 * 1000;

interface OpenTask {
  startedAt: number;
  variant?: string;
  taps: number;
  backs: number;
  errors: number;
  screens: number;
  lastScreen?: string;
}

/**
 * Measures how hard each task is: taps, back presses, screens, errors and time from start to finish.
 * Pure (no SDK); the apps feed it taps, back presses, screen changes and app background/foreground.
 */
export class TaskTracker {
  private open = new Map<TaskName, OpenTask>();
  private backgroundedAt: number | null = null;

  constructor(
    private readonly emit: Emit,
    private readonly now: () => number = Date.now,
  ) {}

  start(task: TaskName, variant?: string): void {
    if (this.open.has(task)) return;
    this.open.set(task, { startedAt: this.now(), variant, taps: 0, backs: 0, errors: 0, screens: 0 });
    this.emit('task_started', variant ? { task, variant } : { task });
  }

  isOpen(task: TaskName): boolean {
    return this.open.has(task);
  }

  tap(): void {
    for (const t of this.open.values()) t.taps++;
  }

  back(): void {
    for (const t of this.open.values()) t.backs++;
  }

  error(): void {
    for (const t of this.open.values()) t.errors++;
  }

  screen(name: string): void {
    for (const t of this.open.values()) {
      if (t.lastScreen === name) continue;
      t.screens++;
      t.lastScreen = name;
    }
  }

  complete(task: TaskName, extra?: { sets_logged?: number; variant?: string }): void {
    const t = this.open.get(task);
    if (!t) return;
    this.open.delete(task);
    const props: AnalyticsProps = {
      task,
      taps: t.taps,
      back_count: t.backs,
      screens: t.screens,
      error_count: t.errors,
      duration_ms: this.now() - t.startedAt,
    };
    const variant = extra?.variant ?? t.variant;
    if (variant) props.variant = variant;
    if (extra?.sets_logged !== undefined) {
      props.sets_logged = extra.sets_logged;
      if (extra.sets_logged > 0) props.taps_per_set = Math.round((t.taps / extra.sets_logged) * 10) / 10;
    }
    this.emit('task_completed', props);
  }

  abandon(task: TaskName): void {
    const t = this.open.get(task);
    if (!t) return;
    this.open.delete(task);
    const props: AnalyticsProps = { task, taps: t.taps, duration_ms: this.now() - t.startedAt };
    if (t.lastScreen) props.last_screen = t.lastScreen;
    if (t.variant) props.variant = t.variant;
    this.emit('task_abandoned', props);
  }

  backgrounded(): void {
    this.backgroundedAt = this.now();
  }

  foregrounded(): void {
    const since = this.backgroundedAt;
    this.backgroundedAt = null;
    if (since === null || this.now() - since <= ABANDON_AFTER_MS) return;
    for (const task of [...this.open.keys()]) this.abandon(task);
  }

  /** Drops open tasks without reporting them (sign-out). */
  clear(): void {
    this.open.clear();
    this.backgroundedAt = null;
  }
}
