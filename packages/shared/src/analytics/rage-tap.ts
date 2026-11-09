const WINDOW_MS = 1000;
const TAPS = 3;

/** Spots rage taps: the same element tapped 3 times within 1 second. */
export class RageTapDetector {
  private key: string | null = null;
  private times: number[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  /** Returns true exactly on the tap that completes a rage tap, then starts over. */
  tap(elementKey: string): boolean {
    const at = this.now();
    if (elementKey !== this.key) {
      this.key = elementKey;
      this.times = [];
    }
    this.times = [...this.times.filter((x) => at - x <= WINDOW_MS), at];
    if (this.times.length < TAPS) return false;
    this.times = [];
    return true;
  }
}
