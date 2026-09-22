export interface MonitorConfig {
  /** A frame whose GPU time exceeds this counts as slow. */
  slowFrameMs: number;
  /** How many recent frames the decision looks at. */
  windowSize: number;
  /** Share of bad frames in a full window that triggers a downgrade. */
  maxBadRatio: number;
  /** Frames ignored right after a (re)build, while shaders compile and caches warm. */
  warmupFrames: number;
}

export const DEFAULT_MONITOR_CONFIG: MonitorConfig = {
  slowFrameMs: 16,
  windowSize: 90,
  maxBadRatio: 0.25,
  warmupFrames: 30,
};

/**
 * Decides when the current preset cannot keep up: once a full window is in and more than
 * `maxBadRatio` of it was bad (slow on the GPU, skipped while busy, or dropped by the browser).
 */
export class FrameMonitor {
  private readonly config: MonitorConfig;
  private window: boolean[] = [];
  private warmupLeft: number;

  constructor(config: Partial<MonitorConfig> = {}) {
    this.config = { ...DEFAULT_MONITOR_CONFIG, ...config };
    this.warmupLeft = this.config.warmupFrames;
  }

  /** A frame that was rendered, with its GPU time. */
  recordFrame(gpuMs: number): void {
    this.push(!(gpuMs <= this.config.slowFrameMs));
  }

  /** A frame that was skipped because the GPU was still busy with the previous one. */
  recordSkipped(): void {
    this.push(true);
  }

  /** Frames the browser reports as dropped since the last call. */
  recordDropped(count: number): void {
    for (let i = 0; i < Math.min(count, this.config.windowSize); i++) this.push(true);
  }

  /** Share of bad frames in the current window, 0 when empty. */
  badRatio(): number {
    if (this.window.length === 0) return 0;
    return this.window.filter(Boolean).length / this.window.length;
  }

  shouldDowngrade(): boolean {
    return (
      this.window.length >= this.config.windowSize && this.badRatio() > this.config.maxBadRatio
    );
  }

  /** Start over, warmup included. */
  reset(): void {
    this.window = [];
    this.warmupLeft = this.config.warmupFrames;
  }

  private push(bad: boolean): void {
    if (this.warmupLeft > 0) {
      this.warmupLeft--;
      return;
    }
    this.window.push(bad);
    if (this.window.length > this.config.windowSize) this.window.shift();
  }
}
