/** Hermes IterationBudget — per-turn API call budget with one grace call. */
export class IterationBudget {
  private used = 0;
  private graceConsumed = false;

  constructor(private readonly maxIterations: number) {}

  consume(): boolean {
    if (this.used < this.maxIterations) {
      this.used += 1;
      return true;
    }
    if (!this.graceConsumed) {
      this.graceConsumed = true;
      this.used += 1;
      return true;
    }
    return false;
  }

  get remaining(): number {
    return Math.max(0, this.maxIterations - this.used);
  }

  get exhausted(): boolean {
    return this.used >= this.maxIterations && this.graceConsumed;
  }

  get totalUsed(): number {
    return this.used;
  }
}
