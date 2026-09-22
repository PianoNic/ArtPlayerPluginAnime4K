import { isPreset, type ActiveMode, type Preset } from './modes.js';

/** Re-benchmark after this long (drivers and browsers change). */
export const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Bump when the presets change. */
const CACHE_VERSION = 1;

interface CacheEntry {
  v: number;
  mode: ActiveMode;
  at: number;
}

/** Just enough of `Storage` to test without a browser. */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** One entry per GPU, video resolution and (bucketed) target size. */
export function benchmarkCacheKey(
  prefix: string,
  gpu: string,
  native: { width: number; height: number },
  target: { width: number; height: number },
): string {
  // 90px buckets, so a slightly resized window still hits the cache.
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
    // Only costs a re-benchmark.
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
