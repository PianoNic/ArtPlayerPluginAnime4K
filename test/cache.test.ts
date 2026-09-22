import { describe, expect, it } from 'vitest';
import {
  benchmarkCacheKey,
  CACHE_TTL_MS,
  readCachedMode,
  writeCachedMode,
  type StorageLike,
} from '../src/cache';

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

const throwing: StorageLike = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

const native = { width: 1280, height: 720 };
const screen = { width: 1920, height: 1080 };

describe('benchmark cache', () => {
  const key = benchmarkCacheKey('p', 'nvidia|ampere', native, screen);

  it('round-trips a decision', () => {
    const storage = memoryStorage();
    writeCachedMode(storage, key, 'balanced', 1000);
    expect(readCachedMode(storage, key, 2000)).toBe('balanced');
  });

  it('round-trips off', () => {
    const storage = memoryStorage();
    writeCachedMode(storage, key, 'off', 1000);
    expect(readCachedMode(storage, key, 2000)).toBe('off');
  });

  it('expires after the TTL and rejects entries from the future', () => {
    const storage = memoryStorage();
    writeCachedMode(storage, key, 'quality', 1000);
    expect(readCachedMode(storage, key, 1000 + CACHE_TTL_MS + 1)).toBeNull();
    expect(readCachedMode(storage, key, 500)).toBeNull();
  });

  it('treats malformed or foreign entries as a miss', () => {
    const storage = memoryStorage();
    storage.data.set(key, 'not json');
    expect(readCachedMode(storage, key)).toBeNull();
    storage.data.set(key, JSON.stringify({ v: 1, mode: 'ultra', at: Date.now() }));
    expect(readCachedMode(storage, key)).toBeNull();
    storage.data.set(key, JSON.stringify({ v: 999, mode: 'quality', at: Date.now() }));
    expect(readCachedMode(storage, key)).toBeNull();
    storage.data.set(key, 'null');
    expect(readCachedMode(storage, key)).toBeNull();
  });

  it('never throws when storage is blocked or full', () => {
    expect(readCachedMode(throwing, key)).toBeNull();
    expect(() => writeCachedMode(throwing, key, 'quality')).not.toThrow();
    expect(readCachedMode(null, key)).toBeNull();
    expect(() => writeCachedMode(null, key, 'quality')).not.toThrow();
  });

  it('keys per GPU and per resolution, tolerating small window changes', () => {
    const otherGpu = benchmarkCacheKey('p', 'intel|xe', native, screen);
    const nudged = benchmarkCacheKey('p', 'nvidia|ampere', native, { width: 1916, height: 1078 });
    const bigger = benchmarkCacheKey('p', 'nvidia|ampere', native, { width: 3840, height: 2160 });
    const source = benchmarkCacheKey('p', 'nvidia|ampere', screen, screen);
    expect(otherGpu).not.toBe(key);
    expect(nudged).toBe(key);
    expect(bigger).not.toBe(key);
    expect(source).not.toBe(key);
  });
});
