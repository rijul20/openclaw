/**
 * Per-entity message batcher. Accumulates messages within a silence window,
 * then fires the batch callback once no new messages arrive for `delayMs`.
 */
export class BatchTimer {
  private messages: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private delayMs: number,
    private onBatch: (messages: string[]) => void,
  ) {}

  /** Add a message. Resets the silence timer. */
  add(message: string): void {
    this.messages.push(message);
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => this.fire(), this.delayMs);
  }

  /** Force-fire the current batch immediately. */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.fire();
  }

  private fire(): void {
    this.timer = null;
    if (this.messages.length === 0) {
      return;
    }
    const batch = this.messages;
    this.messages = [];
    this.onBatch(batch);
  }
}
