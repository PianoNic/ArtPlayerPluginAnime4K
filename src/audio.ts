/** Longest audio delay the plugin applies. A picture later than this is a preset that is too heavy. */
export const MAX_AUDIO_DELAY_MS = 250;
/** Smaller changes to the delay are not worth a ramp. */
export const RETARGET_THRESHOLD_MS = 5;
/**
 * Fastest the delay may change, in seconds of delay per second. Changing a delay line bends the
 * pitch by the same fraction, and 2% stays below what a listener notices.
 */
export const MAX_DELAY_SLOPE = 0.02;

/**
 * How late the upscaled picture reaches the screen compared to the plain video frame: the median of
 * the last `size` frames, so a single slow frame does not move the audio.
 */
export class LagEstimator {
  private samples: number[] = [];

  constructor(
    private readonly size = 30,
    private readonly minSamples = 10,
  ) {}

  push(lagMs: number): void {
    if (!Number.isFinite(lagMs)) return;
    this.samples.push(Math.max(0, lagMs));
    if (this.samples.length > this.size) this.samples.shift();
  }

  /** The smoothed lag in ms, or null until enough frames are in. */
  value(): number | null {
    if (this.samples.length < this.minSamples) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  reset(): void {
    this.samples = [];
  }
}

/** The audio delay for a measured picture lag: the lag itself, within 0..`MAX_AUDIO_DELAY_MS`. */
export function audioDelayFor(lagMs: number | null): number {
  if (lagMs === null || !Number.isFinite(lagMs)) return 0;
  return Math.min(MAX_AUDIO_DELAY_MS, Math.max(0, Math.round(lagMs)));
}

/** Whether moving from `current` to `target` is worth a ramp. */
export function shouldRetarget(currentMs: number, targetMs: number): boolean {
  return (
    Math.abs(targetMs - currentMs) >= RETARGET_THRESHOLD_MS || (targetMs === 0 && currentMs !== 0)
  );
}

/** How long, in seconds, a ramp from `fromMs` to `toMs` takes at `MAX_DELAY_SLOPE`. */
export function rampSeconds(fromMs: number, toMs: number): number {
  return Math.max(0.05, Math.abs(toMs - fromMs) / 1000 / MAX_DELAY_SLOPE);
}

/** iOS routes element audio through Web Audio unreliably; its Safari is left alone. */
export function isIos(nav: {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
}): boolean {
  return (
    /iPad|iPhone|iPod/.test(nav.userAgent) ||
    (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1)
  );
}

interface Graph {
  context: AudioContext;
  delay: DelayNode;
}

// `createMediaElementSource` works once per element and reroutes its audio for good, so the graph
// outlives the plugin: a new player on the same element picks it up again.
const graphs = new WeakMap<HTMLMediaElement, Graph>();

/**
 * Delays a media element's audio through Web Audio: element -> DelayNode -> speakers. The element's
 * own volume and mute still apply, before the source node. Nothing is rerouted until the audio
 * context is running: an element routed into a suspended context would go silent.
 */
export class AudioDelay {
  private graph: Graph | null;
  private context: AudioContext | null = null;
  private failed = false;
  private targetMs = 0;

  constructor(private readonly media: HTMLMediaElement) {
    this.graph = graphs.get(media) ?? null;
    if (this.graph) this.targetMs = Math.round(this.graph.delay.delayTime.value * 1000);
  }

  /** The delay applied right now, in ms, mid-ramp included. */
  get currentMs(): number {
    return this.graph ? Math.round(this.graph.delay.delayTime.value * 1000) : 0;
  }

  /** Ramps the delay to `ms`. Builds the graph on first use once audio is allowed to run. */
  set(ms: number): void {
    if (!this.graph) {
      if (ms === 0 || this.failed || !this.connect()) return;
    }
    const graph = this.graph!;
    if (!shouldRetarget(this.targetMs, ms)) return;
    const param = graph.delay.delayTime;
    const now = graph.context.currentTime;
    const from = param.value * 1000;
    param.cancelScheduledValues(now);
    param.setValueAtTime(from / 1000, now);
    param.linearRampToValueAtTime(ms / 1000, now + rampSeconds(from, ms));
    this.targetMs = ms;
  }

  /** Resume a suspended context; call from a user gesture or `play`. */
  wake(): void {
    const context = this.graph?.context ?? this.context;
    if (context?.state === 'suspended') void context.resume().catch(() => {});
  }

  /** Puts the audio back in step with the element, without the ramp. The graph stays. */
  reset(): void {
    if (!this.graph) return;
    const param = this.graph.delay.delayTime;
    param.cancelScheduledValues(this.graph.context.currentTime);
    param.setValueAtTime(0, this.graph.context.currentTime);
    this.targetMs = 0;
  }

  private connect(): boolean {
    try {
      // Before any user gesture a new context could only start suspended (and log a warning).
      const activation = (navigator as { userActivation?: { hasBeenActive: boolean } })
        .userActivation;
      if (!this.context && activation && !activation.hasBeenActive) return false;
      // The default, lowest latency: Web Audio's own output buffer adds to what the delay fixes.
      this.context ??= new AudioContext();
      if (this.context.state !== 'running') {
        this.wake();
        return false;
      }
      const source = this.context.createMediaElementSource(this.media);
      const delay = this.context.createDelay(MAX_AUDIO_DELAY_MS / 1000 + 0.05);
      source.connect(delay).connect(this.context.destination);
      this.graph = { context: this.context, delay };
      graphs.set(this.media, this.graph);
      return true;
    } catch {
      // No Web Audio, or the page already routed this element itself: leave the audio alone.
      this.failed = true;
      return false;
    }
  }
}
