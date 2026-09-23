import { describe, expect, it } from 'vitest';
import {
  BAD_WINDOWS_TO_OFF,
  BAD_WINDOWS_TO_STEP,
  FrameMonitor,
  watchdogAction,
} from '../src/monitor';

const config = {
  slowFrameMs: 16,
  windowSize: 10,
  maxBadRatio: 0.25,
  warmupFrames: 0,
  missedAllowance: 0,
  graceMs: 0,
};

/** A clock the test moves by hand. */
function clock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const frames = (monitor: FrameMonitor, n: number, ms: number) => {
  for (let i = 0; i < n; i++) monitor.recordFrame(ms);
};

describe('FrameMonitor', () => {
  it('judges nothing before a full window is in', () => {
    const monitor = new FrameMonitor(config);
    frames(monitor, 9, 100);
    expect(monitor.badWindows()).toBe(0);
    monitor.recordFrame(100);
    expect(monitor.badWindows()).toBe(1);
    expect(monitor.badRatio()).toBe(1);
  });

  it('tolerates occasional slow frames', () => {
    const monitor = new FrameMonitor(config);
    frames(monitor, 8, 4);
    frames(monitor, 2, 40);
    expect(monitor.badRatio()).toBe(0.2);
    expect(monitor.badWindows()).toBe(0);
  });

  it('marks a window bad once more than the allowed share is slow', () => {
    const monitor = new FrameMonitor(config);
    frames(monitor, 7, 4);
    frames(monitor, 3, 40);
    expect(monitor.badWindows()).toBe(1);
  });

  it('counts bad windows in a row, and a good window starts the count over', () => {
    const monitor = new FrameMonitor(config);
    frames(monitor, 20, 40);
    expect(monitor.badWindows()).toBe(2);
    frames(monitor, 10, 4);
    expect(monitor.badWindows()).toBe(0);
    frames(monitor, 10, 40);
    expect(monitor.badWindows()).toBe(1);
  });

  it('counts skipped and dropped frames beyond the allowance', () => {
    const monitor = new FrameMonitor(config);
    frames(monitor, 7, 4);
    monitor.recordSkipped();
    monitor.recordDropped(2);
    expect(monitor.badRatio()).toBeCloseTo(0.3);
    expect(monitor.badWindows()).toBe(1);
  });

  it('forgives a few skipped or dropped frames per window', () => {
    const monitor = new FrameMonitor({ ...config, missedAllowance: 2 });
    frames(monitor, 7, 4);
    monitor.recordSkipped();
    monitor.recordDropped(2);
    expect(monitor.badRatio()).toBeCloseTo(0.1);
    expect(monitor.badWindows()).toBe(0);
  });

  it('ignores dropped and skipped frames during the grace period after a reset', () => {
    const time = clock();
    const monitor = new FrameMonitor({ ...config, graceMs: 2000 }, time.now);
    // Playback start: the browser drops a burst, the GPU is briefly busy.
    monitor.recordDropped(50);
    monitor.recordSkipped();
    frames(monitor, 10, 4);
    expect(monitor.badWindows()).toBe(0);
    // A seek later on: same again.
    time.advance(10_000);
    monitor.reset();
    monitor.recordDropped(50);
    frames(monitor, 10, 4);
    expect(monitor.badWindows()).toBe(0);
    // Once the grace period is over, drops count again.
    time.advance(2000);
    monitor.recordDropped(50);
    expect(monitor.badWindows()).toBe(1);
  });

  it('still counts slow GPU frames during the grace period', () => {
    const time = clock();
    const monitor = new FrameMonitor({ ...config, graceMs: 2000 }, time.now);
    frames(monitor, 10, 40);
    expect(monitor.badWindows()).toBe(1);
  });

  it('ignores the warm-up frames after a reset, and drops while warming up', () => {
    const monitor = new FrameMonitor({ ...config, warmupFrames: 5 });
    monitor.recordDropped(50);
    frames(monitor, 5, 500);
    frames(monitor, 10, 4);
    expect(monitor.badWindows()).toBe(0);
  });

  it('starts over on reset', () => {
    const monitor = new FrameMonitor(config);
    frames(monitor, 20, 40);
    expect(monitor.badWindows()).toBe(2);
    monitor.reset();
    expect(monitor.badRatio()).toBe(0);
    expect(monitor.badWindows()).toBe(0);
  });

  it('treats a NaN frame time as bad rather than good', () => {
    const monitor = new FrameMonitor({ ...config, windowSize: 1 });
    monitor.recordFrame(NaN);
    expect(monitor.badWindows()).toBe(1);
  });

  it('caps a huge dropped-frame burst at one window', () => {
    const monitor = new FrameMonitor(config);
    monitor.recordDropped(1_000_000);
    expect(monitor.badRatio()).toBe(1);
    expect(monitor.badWindows()).toBe(1);
  });
});

describe('watchdogAction', () => {
  it('does nothing before two bad windows in a row', () => {
    expect(BAD_WINDOWS_TO_STEP).toBe(2);
    expect(watchdogAction('auto', 'quality', 0, true)).toBe('none');
    expect(watchdogAction('auto', 'quality', 1, true)).toBe('none');
    expect(watchdogAction('quality', 'quality', 1, true)).toBe('none');
  });

  it('never lowers a preset the viewer picked, it warns instead', () => {
    for (const preset of ['performance', 'balanced', 'quality'] as const) {
      for (let windows = BAD_WINDOWS_TO_STEP; windows < 20; windows++) {
        expect(watchdogAction(preset, preset, windows, true)).toBe('warn');
      }
    }
  });

  it('steps auto down one preset after two bad windows', () => {
    expect(watchdogAction('auto', 'quality', 2, true)).toBe('step');
    expect(watchdogAction('auto', 'balanced', 2, true)).toBe('step');
  });

  it('turns auto off only after repeated bad windows at the lowest preset', () => {
    expect(BAD_WINDOWS_TO_OFF).toBe(3);
    expect(watchdogAction('auto', 'performance', 2, true)).toBe('none');
    expect(watchdogAction('auto', 'performance', 3, true)).toBe('step');
  });

  it('only warns in auto when autoDowngrade is off', () => {
    expect(watchdogAction('auto', 'quality', 2, false)).toBe('warn');
  });

  it('ignores a player that renders nothing', () => {
    expect(watchdogAction('auto', 'off', 10, true)).toBe('none');
    expect(watchdogAction('off', 'off', 10, true)).toBe('none');
  });
});

describe('watchdog end to end', () => {
  // Plays 200 frames with the given GPU time through the monitor and the policy, the way the
  // plugin does: every step down rebuilds, which resets the monitor.
  function run(selected: 'auto' | 'quality', start: 'quality' | 'performance', ms: number) {
    const monitor = new FrameMonitor(config);
    let active: 'off' | 'performance' | 'balanced' | 'quality' = start;
    const trail: string[] = [active];
    let warned = 0;
    for (let frame = 0; frame < 200 && active !== 'off'; frame++) {
      monitor.recordFrame(ms);
      const action = watchdogAction(selected, active, monitor.badWindows(), true);
      if (action === 'warn') warned++;
      if (action === 'step') {
        active = active === 'quality' ? 'balanced' : active === 'balanced' ? 'performance' : 'off';
        trail.push(active);
        monitor.reset();
      }
    }
    return { trail, warned, active };
  }

  it('keeps a manual preset rendering on a GPU that cannot keep up', () => {
    const result = run('quality', 'quality', 40);
    expect(result.active).toBe('quality');
    expect(result.trail).toEqual(['quality']);
    expect(result.warned).toBeGreaterThan(0);
  });

  it('walks auto down, giving the lowest preset one more window before off', () => {
    const result = run('auto', 'quality', 40);
    expect(result.trail).toEqual(['quality', 'balanced', 'performance', 'off']);
  });

  it('leaves auto alone on a GPU that keeps up', () => {
    expect(run('auto', 'performance', 4).trail).toEqual(['performance']);
  });
});
