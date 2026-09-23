import { describe, expect, it } from 'vitest';
import {
  audioDelayFor,
  isIos,
  LagEstimator,
  MAX_AUDIO_DELAY_MS,
  MAX_DELAY_SLOPE,
  rampSeconds,
  shouldRetarget,
} from '../src/audio';

describe('LagEstimator', () => {
  it('says nothing until enough frames are in', () => {
    const lag = new LagEstimator(30, 10);
    for (let i = 0; i < 9; i++) lag.push(40);
    expect(lag.value()).toBeNull();
    lag.push(40);
    expect(lag.value()).toBe(40);
  });

  it('is the median, so a few slow frames do not move it', () => {
    const lag = new LagEstimator(30, 10);
    for (let i = 0; i < 25; i++) lag.push(30);
    for (let i = 0; i < 5; i++) lag.push(400);
    expect(lag.value()).toBe(30);
  });

  it('follows a lasting change within one window', () => {
    const lag = new LagEstimator(30, 10);
    for (let i = 0; i < 30; i++) lag.push(30);
    for (let i = 0; i < 16; i++) lag.push(60);
    expect(lag.value()).toBe(60);
  });

  it('ignores NaN and treats negative lag as none', () => {
    const lag = new LagEstimator(3, 1);
    lag.push(NaN);
    expect(lag.value()).toBeNull();
    lag.push(-5);
    expect(lag.value()).toBe(0);
  });

  it('starts over on reset', () => {
    const lag = new LagEstimator(30, 1);
    lag.push(50);
    lag.reset();
    expect(lag.value()).toBeNull();
  });
});

describe('audioDelayFor', () => {
  it('delays the audio by the lag, clamped to 0..MAX_AUDIO_DELAY_MS', () => {
    expect(audioDelayFor(37.4)).toBe(37);
    expect(audioDelayFor(-3)).toBe(0);
    expect(audioDelayFor(900)).toBe(MAX_AUDIO_DELAY_MS);
    expect(MAX_AUDIO_DELAY_MS).toBe(250);
  });

  it('is 0 without a measurement', () => {
    expect(audioDelayFor(null)).toBe(0);
    expect(audioDelayFor(NaN)).toBe(0);
  });
});

describe('shouldRetarget', () => {
  it('skips changes under 5 ms and takes bigger ones', () => {
    expect(shouldRetarget(40, 43)).toBe(false);
    expect(shouldRetarget(40, 45)).toBe(true);
    expect(shouldRetarget(40, 20)).toBe(true);
  });

  it('always goes back to exactly 0', () => {
    expect(shouldRetarget(3, 0)).toBe(true);
    expect(shouldRetarget(0, 0)).toBe(false);
  });
});

describe('rampSeconds', () => {
  it('keeps the delay changing no faster than MAX_DELAY_SLOPE', () => {
    expect(MAX_DELAY_SLOPE).toBe(0.02);
    expect(rampSeconds(0, 40)).toBeCloseTo(2);
    expect(rampSeconds(40, 0)).toBeCloseTo(2);
    const seconds = rampSeconds(30, 150);
    expect((150 - 30) / 1000 / seconds).toBeLessThanOrEqual(MAX_DELAY_SLOPE + 1e-9);
  });

  it('never ramps in zero time', () => {
    expect(rampSeconds(40, 40)).toBeGreaterThan(0);
  });
});

describe('isIos', () => {
  it('spots iPhones and iPads, including iPadOS posing as a Mac', () => {
    expect(isIos({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })).toBe(
      true,
    );
    expect(
      isIos({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 }),
    ).toBe(true);
  });

  it('leaves desktops and Android alone', () => {
    expect(
      isIos({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0 }),
    ).toBe(false);
    expect(isIos({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })).toBe(false);
    expect(isIos({ userAgent: 'Mozilla/5.0 (Linux; Android 15)' })).toBe(false);
  });
});
