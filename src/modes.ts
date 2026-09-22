/** Everything the user can pick. `auto` resolves to one of the other four at runtime. */
export type Mode = 'auto' | 'off' | 'performance' | 'balanced' | 'quality';

/** What is actually rendering. `auto` never appears here. */
export type ActiveMode = Exclude<Mode, 'auto'>;

/** A preset that runs shaders, weakest first. */
export type Preset = Exclude<ActiveMode, 'off'>;

export const MODES: readonly Mode[] = ['auto', 'off', 'performance', 'balanced', 'quality'];

/** Weakest to strongest. The order the downgrade walks backwards through. */
export const PRESETS: readonly Preset[] = ['performance', 'balanced', 'quality'];

export function isMode(value: unknown): value is Mode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value);
}

export function isPreset(value: unknown): value is Preset {
  return typeof value === 'string' && (PRESETS as readonly string[]).includes(value);
}

/** One step weaker. `performance` steps down to `off`, and `off` stays `off`. */
export function stepDown(mode: ActiveMode): ActiveMode {
  if (mode === 'off') return 'off';
  const index = PRESETS.indexOf(mode);
  return index <= 0 ? 'off' : PRESETS[index - 1];
}

/** Median per-frame time of one preset, measured on this device at this video's resolution. */
export interface BenchmarkSample {
  preset: Preset;
  /** Median milliseconds from submit to GPU completion. `Infinity` when the preset failed to build. */
  ms: number;
}

/**
 * The auto-mode decision: the strongest preset whose frame time stays within the budget.
 *
 * Nothing fitting the budget - or nothing measured at all - means `off`. The budget is a ceiling
 * on GPU time per frame, not a target: at 8 ms a 24 fps episode leaves the GPU idle four fifths of
 * the time, which is the headroom the page, the subtitles and the compositor need.
 */
export function pickAutoMode(samples: readonly BenchmarkSample[], budgetMs: number): ActiveMode {
  let best: ActiveMode = 'off';
  for (const preset of PRESETS) {
    const sample = samples.find((s) => s.preset === preset);
    if (sample && Number.isFinite(sample.ms) && sample.ms <= budgetMs) best = preset;
  }
  return best;
}

/** Median of a list of numbers; `Infinity` for an empty list so it can never pass a budget. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return Infinity;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
