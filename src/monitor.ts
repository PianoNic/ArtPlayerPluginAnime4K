import { stepDown, type ActiveMode, type Mode } from './modes.js';

export interface MonitorConfig {
  /** A frame whose GPU time exceeds this counts as slow. */
  slowFrameMs: number;
  /** How many frames one window holds. Each full window is judged once, then a new one starts. */
  windowSize: number;
  /** Share of bad frames that makes a window bad. */
  maxBadRatio: number;
  /** Rendered frames ignored right after a reset, while shaders compile and caches warm. */
  warmupFrames: number;
  /** Skipped and dropped frames forgiven per window; players drop a few even on a fast GPU. */
  missedAllowance: number;
  /** After a reset, skipped and dropped frames are ignored for this long (ms). */
  graceMs: number;
}

export const DEFAULT_MONITOR_CONFIG: MonitorConfig = {
  slowFrameMs: 16,
  windowSize: 90,
  maxBadRatio: 0.25,
  warmupFrames: 30,
  missedAllowance: 6,
  graceMs: 2000,
};

/** Consecutive bad windows before auto steps down one preset. */
export const BAD_WINDOWS_TO_STEP = 2;
/** Consecutive bad windows before auto gives up on its lowest preset and turns off. */
export const BAD_WINDOWS_TO_OFF = 3;

/**
 * Judges the current preset window by window. A frame is bad when it took longer than
 * `slowFrameMs` on the GPU; skipped frames (GPU still busy) and frames the browser dropped only
 * count beyond `missedAllowance` per window, and not at all during the warm-up or the grace period
 * after a reset: playback start, seeks, stalls and quality switches drop frames on any GPU.
 */
export class FrameMonitor {
  private readonly config: MonitorConfig;
  private readonly now: () => number;
  private frames = 0;
  private slow = 0;
  private missed = 0;
  private streak = 0;
  private lastRatio = 0;
  private warmupLeft: number;
  private graceUntil: number;

  constructor(config: Partial<MonitorConfig> = {}, now: () => number = () => performance.now()) {
    this.config = { ...DEFAULT_MONITOR_CONFIG, ...config };
    this.now = now;
    this.warmupLeft = this.config.warmupFrames;
    this.graceUntil = now() + this.config.graceMs;
  }

  /** A frame that was rendered, with its GPU time. */
  recordFrame(gpuMs: number): void {
    if (this.warmupLeft > 0) {
      this.warmupLeft--;
      return;
    }
    this.add(1, gpuMs <= this.config.slowFrameMs ? 0 : 1, 0);
  }

  /** A frame that was skipped because the GPU was still busy with the previous one. */
  recordSkipped(): void {
    if (!this.settled()) return;
    this.add(1, 0, 1);
  }

  /** Frames the browser reports as dropped since the last call. */
  recordDropped(count: number): void {
    if (!this.settled() || !(count > 0)) return;
    const n = Math.min(Math.floor(count), this.config.windowSize);
    this.add(n, 0, n);
  }

  /** Share of bad frames in the last full window, 0 before the first one. */
  badRatio(): number {
    return this.lastRatio;
  }

  /** How many full windows in a row were bad. */
  badWindows(): number {
    return this.streak;
  }

  /** Past the warm-up and the grace period: skipped and dropped frames count again. */
  settled(): boolean {
    return this.warmupLeft === 0 && this.now() >= this.graceUntil;
  }

  /** Start over: warm-up, grace period and bad-window count included. */
  reset(): void {
    this.frames = this.slow = this.missed = this.streak = this.lastRatio = 0;
    this.warmupLeft = this.config.warmupFrames;
    this.graceUntil = this.now() + this.config.graceMs;
  }

  private add(frames: number, slow: number, missed: number): void {
    this.frames += frames;
    this.slow += slow;
    this.missed += missed;
    if (this.frames < this.config.windowSize) return;
    const bad = this.slow + Math.max(0, this.missed - this.config.missedAllowance);
    this.lastRatio = Math.min(1, bad / this.frames);
    this.streak = this.lastRatio > this.config.maxBadRatio ? this.streak + 1 : 0;
    this.frames = this.slow = this.missed = 0;
  }
}

/**
 * What to do about `badWindows` bad windows in a row:
 * - `none` below `BAD_WINDOWS_TO_STEP`, or while nothing renders.
 * - `warn` for a preset the viewer picked (or with `autoDowngrade` off): it keeps rendering, the
 *   viewer is told once. Nothing but the viewer ever lowers their own choice.
 * - `step` for auto: one preset down. Auto's lowest preset only steps to `off` after
 *   `BAD_WINDOWS_TO_OFF`; the only other way auto ends up `off` is its benchmark.
 */
export function watchdogAction(
  selected: Mode,
  active: ActiveMode,
  badWindows: number,
  autoDowngrade: boolean,
): 'none' | 'warn' | 'step' {
  if (active === 'off' || badWindows < BAD_WINDOWS_TO_STEP) return 'none';
  if (selected !== 'auto' || !autoDowngrade) return 'warn';
  if (stepDown(active) === 'off' && badWindows < BAD_WINDOWS_TO_OFF) return 'none';
  return 'step';
}
