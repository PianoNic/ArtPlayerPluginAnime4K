import type Artplayer from 'artplayer';
import { benchmarkCacheKey, readCachedMode, safeLocalStorage, writeCachedMode } from './cache.js';
import { acquireGpu, measurePreset, Renderer, type GpuContext } from './gpu.js';
import { computeLayout, targetChanged, type Rect, type Size } from './layout.js';
import {
  isMode,
  median,
  MODES,
  pickAutoMode,
  PRESETS,
  stepDown,
  type ActiveMode,
  type BenchmarkSample,
  type Mode,
} from './modes.js';
import { FrameMonitor } from './monitor.js';
import { describeMode, resolveOptions, type Anime4kOptions } from './options.js';

export type { Anime4kLabels, Anime4kOptions } from './options.js';
export type { ActiveMode, Mode, Preset } from './modes.js';
export { DEFAULT_LABELS } from './options.js';
export { MODES } from './modes.js';

export const PLUGIN_NAME = 'artplayerPluginAnime4k';
const SETTING_NAME = 'artplayer-plugin-anime4k';

export interface Anime4kPlugin {
  name: typeof PLUGIN_NAME;
  /** Select a mode. Unknown values are ignored. */
  setMode(mode: Mode): void;
  /** The selected mode, `auto` included. */
  getMode(): Mode;
  /** What is rendering right now: auto's pick, a downgraded preset, or `off`. */
  getActiveMode(): ActiveMode;
  /**
   * Split view: the original video left of `position` (0..1 of the width), the upscaled one right
   * of it. `setCompare(false)` shows the upscaled frame in full again.
   */
  setCompare(on: boolean, position?: number): void;
  getCompare(): boolean;
  /** What is rendering and how fast, for a status readout. */
  getStats(): Anime4kStats;
  /** WebGPU is usable in this browser. `false` until the capability check has finished. */
  readonly supported: boolean;
  /** Resolves with `supported` once the capability check has finished. Never rejects. */
  readonly ready: Promise<boolean>;
  /** Stop rendering and remove the canvas and the settings entry. Called on `art.destroy()` too. */
  destroy(): void;
}

export interface Anime4kStats {
  active: ActiveMode;
  /** Average GPU time per frame over the last frames, in ms; null before the first frame. */
  frameMs: number | null;
  /** The video's own resolution. */
  native: Size | null;
  /** The resolution the pipeline renders to (on-screen size times the device pixel ratio). */
  target: Size | null;
  /** Whether an x2 upscale step runs (target more than 1.2x the video on both axes). */
  upscaling: boolean;
}

type VideoFrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export default function artplayerPluginAnime4k(option: Anime4kOptions = {}) {
  return (art: Artplayer): Anime4kPlugin => {
    const opts = resolveOptions(option);
    const video = art.template.$video as VideoFrameCallbackVideo;
    const storage = opts.cache ? safeLocalStorage() : null;
    const log = (...args: unknown[]) => {
      if (opts.debug) console.info('[anime4k]', ...args);
    };

    let selected: Mode = opts.mode;
    let active: ActiveMode = 'off';
    let supported = false;
    let destroyed = false;
    let gpu: GpuContext | null = null;
    let renderer: Renderer | null = null;
    // Set by a downgrade; cleared when the source or the selection changes.
    let ceiling: ActiveMode | null = null;
    // A cross-origin source WebGPU may not read; not retried.
    let blockedSource: string | null = null;
    // Bumped by every rebuild; async work from an older generation stops.
    let generation = 0;
    let built: { native: Size; target: Size } | null = null;
    let settingAdded = false;
    let compare = opts.compare;
    let comparePosition = 0.5;
    let frameMs: number | null = null;

    const canvas = document.createElement('canvas');
    canvas.className = 'art-anime4k';
    Object.assign(canvas.style, {
      position: 'absolute',
      zIndex: '10',
      pointerEvents: 'none',
      display: 'none',
    });
    video.insertAdjacentElement('afterend', canvas);

    // The split line of the compare view.
    const divider = document.createElement('div');
    divider.className = 'art-anime4k-divider';
    Object.assign(divider.style, {
      position: 'absolute',
      zIndex: '10',
      width: '2px',
      marginLeft: '-1px',
      background: 'rgba(255, 255, 255, 0.85)',
      pointerEvents: 'none',
      display: 'none',
    });
    canvas.insertAdjacentElement('afterend', divider);

    function applyCompare(): void {
      const pct = `${(comparePosition * 100).toFixed(2)}%`;
      canvas.style.clipPath = compare ? `inset(0 0 0 ${pct})` : '';
      const shown = compare && canvas.style.display !== 'none';
      divider.style.display = shown ? 'block' : 'none';
      if (shown) {
        const left = parseFloat(canvas.style.left) || 0;
        const width = parseFloat(canvas.style.width) || 0;
        Object.assign(divider.style, {
          left: `${left + width * comparePosition}px`,
          top: canvas.style.top,
          height: canvas.style.height,
        });
      }
    }
    applyCompare();

    const monitor = new FrameMonitor({ slowFrameMs: opts.slowFrameMs });

    // ---- layout -------------------------------------------------------------------------------

    function measure(): { rect: Rect; target: Size } | null {
      if (!video.videoWidth || !video.videoHeight) return null;
      const cs = getComputedStyle(video);
      const px = (value: string) => parseFloat(value) || 0;
      const box: Rect = {
        left: video.offsetLeft + px(cs.borderLeftWidth) + px(cs.paddingLeft),
        top: video.offsetTop + px(cs.borderTopWidth) + px(cs.paddingTop),
        width: video.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight),
        height: video.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom),
      };
      if (box.width <= 0 || box.height <= 0) return null;
      const layout = computeLayout(
        box,
        { width: video.videoWidth, height: video.videoHeight },
        cs.objectFit || 'contain',
        window.devicePixelRatio || 1,
        opts.maxOutputPixels,
      );
      Object.assign(canvas.style, {
        left: `${layout.rect.left}px`,
        top: `${layout.rect.top}px`,
        width: `${layout.rect.width}px`,
        height: `${layout.rect.height}px`,
        transform: cs.transform === 'none' ? '' : cs.transform,
      });
      applyCompare();
      return layout;
    }

    // ---- state --------------------------------------------------------------------------------

    function setActive(next: ActiveMode): void {
      const changed = next !== active;
      active = next;
      if (next === 'off') hideCanvas();
      if (changed) {
        log('active mode', next);
        notify();
      }
      updateSetting();
    }

    function notify(): void {
      try {
        opts.onModeChange?.(selected, active);
      } catch (error) {
        console.error(error);
      }
    }

    function fail(error: unknown): void {
      generation++;
      stopLoop();
      renderer?.release();
      built = null;
      setActive('off');
      if (error instanceof DOMException && error.name === 'SecurityError') {
        blockedSource = video.currentSrc;
        console.warn(
          '[anime4k] The video is cross-origin without CORS, so WebGPU cannot read its frames. ' +
            'Serve it from the same origin or with Access-Control-Allow-Origin.',
        );
      } else {
        console.warn('[anime4k] Upscaling stopped:', error);
      }
      try {
        opts.onError?.(error);
      } catch (callbackError) {
        console.error(callbackError);
      }
    }

    function hideCanvas(): void {
      canvas.style.display = 'none';
      frameMs = null;
      applyCompare();
    }

    // ---- decision -----------------------------------------------------------------------------

    async function benchmark(native: Size, target: Size, gen: number): Promise<ActiveMode | null> {
      if (!gpu) return 'off';
      const samples: BenchmarkSample[] = [];
      for (const preset of PRESETS) {
        let ms = Infinity;
        try {
          ms = median(await measurePreset(gpu, video, preset, native, target));
        } catch (error) {
          if (error instanceof DOMException && error.name === 'SecurityError') throw error;
          log('benchmark failed for', preset, error);
        }
        if (gen !== generation || destroyed) return null;
        samples.push({ preset, ms });
        log('benchmark', preset, `${ms.toFixed(2)} ms`);
        // Stronger presets are slower still.
        if (!(ms <= opts.frameBudgetMs)) break;
      }
      return pickAutoMode(samples, opts.frameBudgetMs);
    }

    function cacheKey(native: Size, target: Size): string {
      return benchmarkCacheKey(opts.cacheKey, gpu?.name ?? 'unknown', native, target);
    }

    /** Works out what should render for the current selection and source, then builds it. */
    async function apply(): Promise<void> {
      const gen = ++generation;
      if (destroyed) return;
      if (!supported || selected === 'off' || !gpu) {
        stopLoop();
        renderer?.release();
        built = null;
        setActive('off');
        return;
      }
      if (blockedSource !== null && blockedSource === video.currentSrc) {
        setActive('off');
        return;
      }
      const layout = measure();
      // Not laid out yet; `loadedmetadata` or the resize observer calls back.
      if (!layout) return;
      const native = { width: video.videoWidth, height: video.videoHeight };
      const target = layout.target;

      let next: ActiveMode;
      try {
        if (selected === 'auto') {
          const key = cacheKey(native, target);
          const cached = readCachedMode(storage, key);
          if (cached) {
            next = cached;
            log('auto (cached)', cached);
          } else {
            // Needs a decoded frame; `loadeddata` calls back.
            if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
            const picked = await benchmark(native, target, gen);
            if (picked === null) return;
            next = picked;
            writeCachedMode(storage, key, next);
          }
        } else {
          next = selected;
        }
        if (ceiling && PRESETS.indexOf(next as never) > PRESETS.indexOf(ceiling as never)) {
          next = ceiling;
        }
        if (next === 'off') {
          stopLoop();
          renderer?.release();
          built = null;
          setActive('off');
          return;
        }
        renderer ??= new Renderer(gpu, canvas);
        canvas.width = target.width;
        canvas.height = target.height;
        await renderer.build(next, native, target);
        if (gen !== generation || destroyed) return;
      } catch (error) {
        if (gen === generation) fail(error);
        return;
      }
      built = { native, target };
      monitor.reset();
      frameMs = null;
      firstFrame = true;
      setActive(next);
      startLoop();
    }

    function downgrade(): void {
      const next = stepDown(active);
      log('downgrade', active, '->', next, `bad ratio ${monitor.badRatio().toFixed(2)}`);
      ceiling = next;
      if (selected === 'auto' && built)
        writeCachedMode(storage, cacheKey(built.native, built.target), next);
      void apply();
    }

    // ---- frame loop ---------------------------------------------------------------------------

    let loopHandle: number | null = null;
    let loopUsesVideoCallback = false;
    let busy = false;
    let firstFrame = true;
    let lastTime = -1;
    let lastDropped = 0;
    let framesSinceDropCheck = 0;

    function schedule(): void {
      if (destroyed || loopHandle !== null) return;
      if (typeof video.requestVideoFrameCallback === 'function') {
        loopUsesVideoCallback = true;
        loopHandle = video.requestVideoFrameCallback(onFrame);
      } else {
        loopUsesVideoCallback = false;
        loopHandle = requestAnimationFrame(onFrame);
      }
    }

    function stopLoop(): void {
      if (loopHandle === null) return;
      if (loopUsesVideoCallback) video.cancelVideoFrameCallback?.(loopHandle);
      else cancelAnimationFrame(loopHandle);
      loopHandle = null;
    }

    function startLoop(): void {
      stopLoop();
      lastTime = -1;
      lastDropped = droppedFrames();
      schedule();
      // A paused video presents no new frames: draw the current one now.
      if (video.paused) onFrame();
    }

    function droppedFrames(): number {
      try {
        return video.getVideoPlaybackQuality?.().droppedVideoFrames ?? 0;
      } catch {
        return 0;
      }
    }

    function onFrame(): void {
      loopHandle = null;
      if (destroyed || active === 'off' || !renderer?.ready) return;
      schedule();

      if (document.visibilityState === 'hidden') return;
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      // A quality switch changes the frame size before `resize` fires.
      if (nativeChanged()) {
        onLayoutChange();
        return;
      }
      if (video.paused && video.currentTime === lastTime && !firstFrame) return;
      if (busy) {
        if (!video.paused) monitor.recordSkipped();
        return;
      }
      lastTime = video.currentTime;

      if (++framesSinceDropCheck >= 30) {
        framesSinceDropCheck = 0;
        const dropped = droppedFrames();
        if (dropped > lastDropped && !video.paused) monitor.recordDropped(dropped - lastDropped);
        lastDropped = dropped;
      }

      const gen = generation;
      busy = true;
      renderer
        .render(video)
        .then((ms) => {
          busy = false;
          if (gen !== generation || destroyed) return;
          if (firstFrame) {
            firstFrame = false;
            canvas.style.display = 'block';
            applyCompare();
          }
          frameMs = frameMs === null ? ms : frameMs * 0.9 + ms * 0.1;
          if (!video.paused) monitor.recordFrame(ms);
          if (opts.autoDowngrade && monitor.shouldDowngrade()) downgrade();
        })
        .catch((error: unknown) => {
          busy = false;
          if (gen === generation && !destroyed) fail(error);
        });
    }

    // ---- reacting to the player ---------------------------------------------------------------

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    function onLayoutChange(): void {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        if (destroyed || !supported) return;
        const layout = measure();
        if (!layout) return;
        if (!built) {
          if (selected !== 'off') void apply();
        } else if (nativeChanged() || targetChanged(built.target, layout.target)) {
          void apply();
        }
      }, 150);
    }

    function onSourceStart(): void {
      // New source: hide the old frame and forget its downgrade.
      hideCanvas();
      ceiling = null;
      firstFrame = true;
    }

    function nativeChanged(): boolean {
      return (
        !built ||
        built.native.width !== video.videoWidth ||
        built.native.height !== video.videoHeight
      );
    }

    function onSourceReady(): void {
      if (!supported) return;
      if (nativeChanged()) {
        void apply();
      } else if (active !== 'off') {
        startLoop();
      } else if (selected !== 'off') {
        void apply();
      }
    }

    function onVisibility(): void {
      if (document.visibilityState === 'visible') {
        monitor.reset();
        if (active !== 'off') startLoop();
      }
    }

    const videoEvents: [string, () => void][] = [
      ['loadstart', onSourceStart],
      ['loadedmetadata', onSourceReady],
      ['loadeddata', onSourceReady],
      ['resize', onLayoutChange],
      ['play', onVisibility],
    ];
    for (const [event, handler] of videoEvents) video.addEventListener(event, handler);
    document.addEventListener('visibilitychange', onVisibility);

    const resizeObserver =
      typeof ResizeObserver === 'function' ? new ResizeObserver(onLayoutChange) : null;
    resizeObserver?.observe(video);
    art.on('resize', onLayoutChange);
    art.on('fullscreen', onLayoutChange);
    art.on('fullscreenWeb', onLayoutChange);
    art.on('aspectRatio', onLayoutChange);
    art.on('flip', onLayoutChange);

    // ---- settings menu ------------------------------------------------------------------------

    function buildSetting() {
      return {
        name: SETTING_NAME,
        html: opts.labels.setting,
        icon: opts.icon,
        tooltip: describeMode(selected, active, opts.labels, supported),
        selector: MODES.map((mode) => ({
          html: opts.labels[mode],
          value: mode,
          default: mode === selected,
        })),
        onSelect(item: { value?: unknown }) {
          if (isMode(item.value)) setMode(item.value);
          return describeMode(selected, active, opts.labels, supported);
        },
      };
    }

    function updateSetting(): void {
      if (!settingAdded || destroyed) return;
      try {
        art.setting.update(buildSetting());
      } catch {
        // Settings panel not available on this player.
      }
    }

    function addSetting(): void {
      if (!opts.setting || !supported || settingAdded) return;
      try {
        art.setting.add(buildSetting());
        settingAdded = true;
      } catch {
        // `setting: false` on the player, or an ArtPlayer without the settings component.
      }
    }

    // ---- public API ---------------------------------------------------------------------------

    function setMode(mode: Mode): void {
      if (destroyed || !isMode(mode)) return;
      const changed = mode !== selected;
      selected = mode;
      ceiling = null;
      if (changed) notify();
      updateSetting();
      void apply();
    }

    function destroy(): void {
      if (destroyed) return;
      destroyed = true;
      generation++;
      stopLoop();
      if (resizeTimer) clearTimeout(resizeTimer);
      for (const [event, handler] of videoEvents) video.removeEventListener(event, handler);
      document.removeEventListener('visibilitychange', onVisibility);
      resizeObserver?.disconnect();
      if (settingAdded) {
        try {
          art.setting.remove(SETTING_NAME);
        } catch {
          // Player already torn down.
        }
      }
      renderer?.destroy();
      renderer = null;
      gpu?.device.destroy();
      gpu = null;
      canvas.remove();
      divider.remove();
    }

    art.on('destroy', destroy);

    const ready = acquireGpu().then((context) => {
      if (destroyed) {
        context?.device.destroy();
        return false;
      }
      gpu = context;
      supported = context !== null;
      log(supported ? `WebGPU on ${context?.name}` : 'WebGPU unavailable; staying off');
      if (context) {
        void context.device.lost.then((info) => {
          if (destroyed || info.reason === 'destroyed') return;
          gpu = null;
          renderer = null;
          supported = false;
          fail(new Error(`GPU device lost: ${info.message}`));
        });
      }
      addSetting();
      if (supported) void apply();
      else setActive('off');
      return supported;
    });

    return {
      name: PLUGIN_NAME,
      setMode,
      getMode: () => selected,
      getActiveMode: () => active,
      setCompare(on: boolean, position?: number) {
        compare = on === true;
        if (typeof position === 'number' && Number.isFinite(position))
          comparePosition = Math.min(1, Math.max(0, position));
        applyCompare();
      },
      getCompare: () => compare,
      getStats(): Anime4kStats {
        const native = built?.native ?? null;
        const target = built?.target ?? null;
        return {
          active,
          frameMs: active === 'off' ? null : frameMs,
          native,
          target,
          upscaling:
            !!native &&
            !!target &&
            target.width > native.width * 1.2 &&
            target.height > native.height * 1.2,
        };
      },
      get supported() {
        return supported;
      },
      ready,
      destroy,
    };
  };
}

export { artplayerPluginAnime4k };
