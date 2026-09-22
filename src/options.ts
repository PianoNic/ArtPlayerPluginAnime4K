import { isMode, type ActiveMode, type Mode } from './modes.js';

/** Every user-facing string. Pass your own to translate the setting entry. */
export interface Anime4kLabels {
  /** Name of the entry in the settings menu. */
  setting: string;
  auto: string;
  off: string;
  performance: string;
  balanced: string;
  quality: string;
  /** Tooltip while auto is selected. `{mode}` is replaced with the label of the preset auto chose. */
  autoActive: string;
  /** Tooltip when the browser or the video cannot be upscaled. */
  unsupported: string;
}

export const DEFAULT_LABELS: Anime4kLabels = {
  setting: 'Upscaling',
  auto: 'Auto',
  off: 'Off',
  performance: 'Performance',
  balanced: 'Balanced',
  quality: 'Quality',
  autoActive: 'Auto ({mode})',
  unsupported: 'Not supported',
};

export interface Anime4kOptions {
  /** Starting mode. Default `auto`. */
  mode?: Mode;
  /** Replaces any of the default English labels. */
  labels?: Partial<Anime4kLabels>;
  /**
   * Fires when the selected mode or the preset actually rendering changes - a pick in the menu,
   * `setMode()`, auto settling after its benchmark, or a runtime downgrade.
   */
  onModeChange?: (mode: Mode, active: ActiveMode) => void;
  /** Fires when upscaling had to stop: no WebGPU, a cross-origin video, a lost GPU device. */
  onError?: (error: unknown) => void;
  /** Add an entry to ArtPlayer's settings menu. Default `true`. Needs `setting: true` on the player. */
  setting?: boolean;
  /** SVG or HTML for the settings entry icon. */
  icon?: string;
  /** Split view: the left half shows the original video, the right half the upscaled one. */
  compare?: boolean;
  /** Auto picks the strongest preset whose median GPU time per frame stays under this. Default 8 ms. */
  frameBudgetMs?: number;
  /** Step down one preset when frames keep taking longer than this. Default 16 ms. */
  slowFrameMs?: number;
  /** Step down one preset when the GPU cannot keep up. Default `true`. */
  autoDowngrade?: boolean;
  /** Upper bound on the canvas backing store, in pixels. Default 3840 x 2160. */
  maxOutputPixels?: number;
  /** Remember the auto benchmark per device in localStorage. Default `true`. */
  cache?: boolean;
  /** localStorage key prefix. Default `artplayer-plugin-anime4k`. */
  cacheKey?: string;
  /** Log decisions (benchmark numbers, downgrades) to the console. Default `false`. */
  debug?: boolean;
}

export interface ResolvedOptions {
  mode: Mode;
  labels: Anime4kLabels;
  onModeChange: ((mode: Mode, active: ActiveMode) => void) | null;
  onError: ((error: unknown) => void) | null;
  setting: boolean;
  icon: string;
  compare: boolean;
  frameBudgetMs: number;
  slowFrameMs: number;
  autoDowngrade: boolean;
  maxOutputPixels: number;
  cache: boolean;
  cacheKey: string;
  debug: boolean;
}

/**
 * Lucide "sparkles" (ISC licence). `fill:none` is inline because ArtPlayer fills every svg in the
 * player, which would turn the outline into a solid blob.
 */
export const DEFAULT_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" style="fill:none" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/></svg>';

function positive(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(max, Math.max(min, value));
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

/** Fills in defaults and drops invalid values. Never throws. */
export function resolveOptions(input: Anime4kOptions | null | undefined = {}): ResolvedOptions {
  const o = (input && typeof input === 'object' ? input : {}) as Anime4kOptions;
  const labels = { ...DEFAULT_LABELS };
  if (o.labels && typeof o.labels === 'object') {
    for (const key of Object.keys(DEFAULT_LABELS) as (keyof Anime4kLabels)[]) {
      labels[key] = nonEmptyString(o.labels[key], DEFAULT_LABELS[key]);
    }
  }
  return {
    mode: isMode(o.mode) ? o.mode : 'auto',
    labels,
    onModeChange: typeof o.onModeChange === 'function' ? o.onModeChange : null,
    onError: typeof o.onError === 'function' ? o.onError : null,
    setting: o.setting !== false,
    icon: nonEmptyString(o.icon, DEFAULT_ICON),
    compare: o.compare === true,
    frameBudgetMs: positive(o.frameBudgetMs, 8, 1, 100),
    slowFrameMs: positive(o.slowFrameMs, 16, 1, 200),
    autoDowngrade: o.autoDowngrade !== false,
    maxOutputPixels: Math.round(positive(o.maxOutputPixels, 3840 * 2160, 320 * 180, 7680 * 4320)),
    cache: o.cache !== false,
    cacheKey: nonEmptyString(o.cacheKey, 'artplayer-plugin-anime4k'),
    debug: o.debug === true,
  };
}

/** The label shown next to the settings entry for the current state. */
export function describeMode(
  mode: Mode,
  active: ActiveMode,
  labels: Anime4kLabels,
  supported: boolean,
): string {
  if (!supported) return labels.unsupported;
  if (mode === 'auto') return labels.autoActive.replace('{mode}', labels[active]);
  return labels[mode];
}
