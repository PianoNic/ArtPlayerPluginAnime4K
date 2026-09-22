import { describe, expect, it } from 'vitest';
import { computeLayout, fitRect, targetChanged } from '../src/layout';

const box = { left: 0, top: 0, width: 1000, height: 1000 };
const wide = { width: 1920, height: 1080 };
const at = (width: number, height: number) => ({ left: 0, top: 0, width, height });

describe('fitRect', () => {
  it('letterboxes with contain', () => {
    const rect = fitRect(box, wide, 'contain');
    expect(rect.left).toBeCloseTo(0);
    expect(rect.top).toBeCloseTo(218.75);
    expect(rect.width).toBeCloseTo(1000);
    expect(rect.height).toBeCloseTo(562.5);
  });

  it('stretches with fill (ArtPlayer aspect-ratio mode)', () => {
    expect(fitRect(box, wide, 'fill')).toEqual(box);
  });

  it('crops with cover', () => {
    const rect = fitRect(box, wide, 'cover');
    expect(rect.height).toBe(1000);
    expect(rect.width).toBeCloseTo(1777.78, 1);
    expect(rect.left).toBeCloseTo(-388.89, 1);
  });

  it('respects the box offset', () => {
    const rect = fitRect({ left: 10, top: 20, width: 1000, height: 1000 }, wide, 'contain');
    expect(rect.left).toBeCloseTo(10);
    expect(rect.top).toBeCloseTo(238.75);
  });

  it('returns the box unchanged for a video without dimensions', () => {
    expect(fitRect(box, { width: 0, height: 0 }, 'contain')).toEqual(box);
  });
});

describe('computeLayout', () => {
  it('scales the target by the device pixel ratio', () => {
    const layout = computeLayout(at(960, 540), wide, 'contain', 2, Infinity);
    expect(layout.target).toEqual({ width: 1920, height: 1080 });
    expect(layout.rect.width).toBe(960);
  });

  it('caps the target at maxPixels, keeping the aspect ratio', () => {
    const layout = computeLayout(at(2560, 1440), wide, 'contain', 2, 3840 * 2160);
    expect(layout.target.width * layout.target.height).toBeLessThanOrEqual(3840 * 2160 + 4000);
    expect(layout.target.width / layout.target.height).toBeCloseTo(16 / 9, 2);
  });

  it('falls back to a ratio of 1 for a broken devicePixelRatio', () => {
    const layout = computeLayout(at(640, 360), wide, 'contain', NaN, Infinity);
    expect(layout.target).toEqual({ width: 640, height: 360 });
  });
});

describe('targetChanged', () => {
  it('is true with nothing built', () => {
    expect(targetChanged(null, { width: 1, height: 1 })).toBe(true);
  });

  it('ignores changes within tolerance and reacts to bigger ones', () => {
    const current = { width: 1920, height: 1080 };
    expect(targetChanged(current, { width: 1900, height: 1070 })).toBe(false);
    expect(targetChanged(current, { width: 3840, height: 2160 })).toBe(true);
  });
});
