import { describe, expect, it } from 'vitest';
import { FrameMonitor } from '../src/monitor';

const config = { slowFrameMs: 16, windowSize: 10, maxBadRatio: 0.25, warmupFrames: 0 };

describe('FrameMonitor', () => {
  it('never downgrades before a full window is in', () => {
    const monitor = new FrameMonitor(config);
    for (let i = 0; i < 9; i++) monitor.recordFrame(100);
    expect(monitor.shouldDowngrade()).toBe(false);
    monitor.recordFrame(100);
    expect(monitor.shouldDowngrade()).toBe(true);
  });

  it('tolerates occasional slow frames', () => {
    const monitor = new FrameMonitor(config);
    for (let i = 0; i < 8; i++) monitor.recordFrame(4);
    monitor.recordFrame(40);
    monitor.recordFrame(40);
    expect(monitor.badRatio()).toBe(0.2);
    expect(monitor.shouldDowngrade()).toBe(false);
  });

  it('downgrades once more than the allowed share is bad', () => {
    const monitor = new FrameMonitor(config);
    for (let i = 0; i < 7; i++) monitor.recordFrame(4);
    for (let i = 0; i < 3; i++) monitor.recordFrame(40);
    expect(monitor.shouldDowngrade()).toBe(true);
  });

  it('counts skipped and dropped frames as bad', () => {
    const monitor = new FrameMonitor(config);
    for (let i = 0; i < 7; i++) monitor.recordFrame(4);
    monitor.recordSkipped();
    monitor.recordDropped(2);
    expect(monitor.badRatio()).toBeCloseTo(0.3);
    expect(monitor.shouldDowngrade()).toBe(true);
  });

  it('keeps only the most recent window', () => {
    const monitor = new FrameMonitor(config);
    for (let i = 0; i < 10; i++) monitor.recordFrame(40);
    for (let i = 0; i < 10; i++) monitor.recordFrame(4);
    expect(monitor.badRatio()).toBe(0);
    expect(monitor.shouldDowngrade()).toBe(false);
  });

  it('ignores the warm-up frames after a (re)build', () => {
    const monitor = new FrameMonitor({ ...config, warmupFrames: 5 });
    for (let i = 0; i < 5; i++) monitor.recordFrame(500);
    for (let i = 0; i < 10; i++) monitor.recordFrame(4);
    expect(monitor.shouldDowngrade()).toBe(false);
  });

  it('starts over on reset', () => {
    const monitor = new FrameMonitor(config);
    for (let i = 0; i < 10; i++) monitor.recordFrame(40);
    expect(monitor.shouldDowngrade()).toBe(true);
    monitor.reset();
    expect(monitor.badRatio()).toBe(0);
    expect(monitor.shouldDowngrade()).toBe(false);
  });

  it('treats a NaN frame time as bad rather than good', () => {
    const monitor = new FrameMonitor({ ...config, windowSize: 1 });
    monitor.recordFrame(NaN);
    expect(monitor.shouldDowngrade()).toBe(true);
  });

  it('caps a huge dropped-frame burst at one window', () => {
    const monitor = new FrameMonitor(config);
    monitor.recordDropped(1_000_000);
    expect(monitor.badRatio()).toBe(1);
  });
});
