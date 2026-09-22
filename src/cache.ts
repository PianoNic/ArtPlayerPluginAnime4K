import { isPreset, type ActiveMode, type Preset } from './modes.js';

/** Benchmarks go stale when drivers and browsers update; re-measure after this long. */
export const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Bumped whenever the preset definitions change, so old measurements stop applying. */
const CACHE_VERSION = 1;

interface CacheEntry {
  v: number;
  mode: ActiveMode;
  at: number;
}

/** Just enough of `Storage` to test without a browser. */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * One entry per GPU and per resolution pair. The same card picks a different preset for a 480p
 * source on a 4K screen than for a 1080p source in a small window, and a laptop's integrated GPU
 * must not reuse what its discrete GPU measured.
 */
export function benchmarkCacheKey(
  prefix: string,
  gpu: string,
  native: { width: number; height: number },
  target: { width: number; height: number },
): string {
  // Rounded to 90px steps so a window resized by a few pixels still hits the cache.
  const bucket = (n: number) => Math.round(n / 90) * 90;
  return `${prefix}:bench:v${CACHE_VERSION}:${gpu}:${native.width}x${native.height}:${bucket(target.width)}x${bucket(target.height)}`;
}

/** Reads a cached decision. Anything missing, malformed, stale or unreadable is a miss. */
export function readCachedMode(
  storage: StorageLike | null,
  key: string,
  now: number = Date.now(),
): ActiveMode | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Partial<CacheEntry>;
    if (entry.v !== CACHE_VERSION || typeof entry.at !== 'number') return null;
    if (now - entry.at > CACHE_TTL_MS || entry.at > now) return null;
    if (entry.mode === 'off' || isPreset(entry.mode)) return entry.mode as Preset | 'off';
    return null;
  } catch {
    return null;
  }
}

/** Writes a decision. Quota errors, private mode and blocked storage are all swallowed. */
export function writeCachedMode(
  storage: StorageLike | null,
  key: string,
  mode: ActiveMode,
  now: number = Date.now(),
): void {
  if (!storage) return;
  try {
    const entry: CacheEntry = { v: CACHE_VERSION, mode, at: now };
    storage.setItem(key, JSON.stringify(entry));
  } catch {
    // Storage is a convenience; losing it only costs a re-benchmark.
  }
}

/** `localStorage`, or null when merely touching it throws (sandboxed iframes, blocked cookies). */
export function safeLocalStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
