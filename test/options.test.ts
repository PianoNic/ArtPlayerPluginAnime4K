import { describe, expect, it } from 'vitest';
import { DEFAULT_ICON, DEFAULT_LABELS, describeMode, resolveOptions } from '../src/options';

describe('resolveOptions', () => {
  it('fills every default for no options', () => {
    const o = resolveOptions();
    expect(o.mode).toBe('auto');
    expect(o.labels).toEqual(DEFAULT_LABELS);
    expect(o.setting).toBe(true);
    expect(o.icon).toBe(DEFAULT_ICON);
    expect(o.frameBudgetMs).toBe(8);
    expect(o.slowFrameMs).toBe(16);
    expect(o.autoDowngrade).toBe(true);
    expect(o.maxOutputPixels).toBe(3840 * 2160);
    expect(o.cache).toBe(true);
    expect(o.cacheKey).toBe('artplayer-plugin-anime4k');
    expect(o.onModeChange).toBeNull();
    expect(o.debug).toBe(false);
  });

  it('survives null, non-objects and garbage', () => {
    expect(resolveOptions(null).mode).toBe('auto');
    expect(resolveOptions('quality' as never).mode).toBe('auto');
    const o = resolveOptions({
      mode: 'ultra' as never,
      frameBudgetMs: -3,
      slowFrameMs: NaN,
      maxOutputPixels: 'big' as never,
      onModeChange: 'nope' as never,
      icon: '   ',
    });
    expect(o.mode).toBe('auto');
    expect(o.frameBudgetMs).toBe(8);
    expect(o.slowFrameMs).toBe(16);
    expect(o.maxOutputPixels).toBe(3840 * 2160);
    expect(o.onModeChange).toBeNull();
    expect(o.icon).toBe(DEFAULT_ICON);
  });

  it('keeps valid values and clamps extreme ones', () => {
    const cb = () => {};
    const o = resolveOptions({
      mode: 'quality',
      frameBudgetMs: 5000,
      maxOutputPixels: 10,
      onModeChange: cb,
      setting: false,
      cache: false,
      autoDowngrade: false,
    });
    expect(o.mode).toBe('quality');
    expect(o.frameBudgetMs).toBe(100);
    expect(o.maxOutputPixels).toBe(320 * 180);
    expect(o.onModeChange).toBe(cb);
    expect(o.setting).toBe(false);
    expect(o.cache).toBe(false);
    expect(o.autoDowngrade).toBe(false);
  });

  it('merges partial labels over the defaults and ignores empty ones', () => {
    const o = resolveOptions({
      labels: { setting: 'Hochskalierung', off: '', quality: 'Qualität' },
    });
    expect(o.labels.setting).toBe('Hochskalierung');
    expect(o.labels.quality).toBe('Qualität');
    expect(o.labels.off).toBe('Off');
    expect(o.labels.auto).toBe('Auto');
  });

  it('does not share the defaults object between players', () => {
    const a = resolveOptions();
    a.labels.setting = 'changed';
    expect(resolveOptions().labels.setting).toBe('Upscaling');
  });
});

describe('describeMode', () => {
  it('names the explicit mode', () => {
    expect(describeMode('balanced', 'balanced', DEFAULT_LABELS, true)).toBe('Balanced');
  });

  it('shows what auto picked', () => {
    expect(describeMode('auto', 'quality', DEFAULT_LABELS, true)).toBe('Auto (Quality)');
    expect(describeMode('auto', 'off', DEFAULT_LABELS, true)).toBe('Auto (Off)');
  });

  it('uses translated labels', () => {
    const labels = {
      ...DEFAULT_LABELS,
      autoActive: 'Automatisch: {mode}',
      performance: 'Leistung',
    };
    expect(describeMode('auto', 'performance', labels, true)).toBe('Automatisch: Leistung');
  });

  it('says unsupported when WebGPU is missing', () => {
    expect(describeMode('auto', 'off', DEFAULT_LABELS, false)).toBe('Not supported');
  });
});
