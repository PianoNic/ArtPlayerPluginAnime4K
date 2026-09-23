<p align="center">
  <img src="assets/icon.svg" width="180" alt="ArtPlayerPluginAnime4K Logo" />
</p>

<h1 align="center">ArtPlayerPluginAnime4K</h1>

<p align="center">
  <strong>Real-time Anime4K upscaling for ArtPlayer, on WebGPU.</strong>
</p>

<p align="center">
  <a href="https://github.com/PianoNic/ArtPlayerPluginAnime4K"><img src="https://badgetrack.pianonic.ch/badge?tag=artplayerpluginanime4k&label=visits&color=0d1117&style=flat" alt="visits" /></a>
  <a href="https://www.npmjs.com/package/artplayer-plugin-anime4k"><img src="https://img.shields.io/npm/v/artplayer-plugin-anime4k?color=0d1117&label=npm" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/artplayer-plugin-anime4k"><img src="https://img.shields.io/npm/dm/artplayer-plugin-anime4k?color=0d1117&label=downloads" alt="npm downloads" /></a>
  <a href="https://github.com/PianoNic/ArtPlayerPluginAnime4K/blob/main/LICENSE"><img src="https://img.shields.io/github/license/PianoNic/ArtPlayerPluginAnime4K?color=0d1117" alt="MIT" /></a>
  <img src="https://img.shields.io/badge/WebGPU-0d1117.svg" alt="WebGPU" />
  <img src="https://img.shields.io/badge/TypeScript-0d1117.svg" alt="TypeScript" />
</p>

---

> **Heads up:** early development, pre-1.0 - options may still change between minor versions.
> Upscaling needs **WebGPU** (Chrome / Edge 113+, Safari 26+, Firefox 141+ on Windows) and a video
> that is **same-origin or served with CORS**. Everywhere else the plugin stays off quietly and the
> player works exactly as before.

## What is it?

An [ArtPlayer](https://artplayer.org) plugin that runs [Anime4K](https://github.com/bloc97/Anime4K)
on every frame, in the browser, on the GPU. A 720p episode on a 1440p screen comes out with clean
line art instead of a bilinear smear.

It is built on [`anime4k-webgpu-async`](https://github.com/daika7ana/Anime4K-WebGPU-Async), the
maintained fork of Anime4K-WebGPU. What this plugin adds on top is everything a real player needs:
a mode picker in the settings menu, a benchmark that picks the right preset for the device, a
watchdog that steps down when the GPU falls behind, and a canvas that follows fullscreen, aspect
ratio, quality switches and source changes without the host doing anything.

## Features

- **Five modes** - `auto`, `off`, `performance`, `balanced`, `quality`, switchable from the settings gear or the API
- **Auto mode** - benchmarks each preset on the actual video resolution and screen size, picks the strongest one that fits the frame budget, and remembers the result per GPU
- **Runtime downgrade** - in auto, watches GPU time, skipped and dropped frames and steps down one preset when the GPU cannot keep up; a preset the viewer picked is never lowered, they get a one-time notice instead
- **Audio stays in sync** - the upscaled picture reaches the screen a little after the plain video would have; the audio is delayed by exactly that much
- **Graceful fallback** - no WebGPU, no adapter, a cross-origin video or a lost GPU all end in `off`, never in an exception
- **Layered, not replaced** - a `<canvas>` over the `<video>`; playback, audio, seeking, subtitles (including JASSUB) and fullscreen are untouched
- **Idle when idle** - `requestVideoFrameCallback`-driven, so a paused or hidden video costs nothing
- **Follows the player** - rebuilds on quality switch, source change, resize and fullscreen; mirrors ArtPlayer's flip and aspect-ratio settings
- **Translatable** - every label comes in through `labels`
- **Lazy** - the Anime4K shaders are a separate chunk, only loaded once WebGPU is confirmed

## Installation

```bash
npm install artplayer-plugin-anime4k
```

or `bun add artplayer-plugin-anime4k`. ArtPlayer 5 is a peer dependency.

## Usage

```ts
import Artplayer from 'artplayer';
import artplayerPluginAnime4k from 'artplayer-plugin-anime4k';

const art = new Artplayer({
  container: '#player',
  url: '/videos/episode-01.m3u8',
  setting: true, // the mode picker lives in the settings menu
  plugins: [artplayerPluginAnime4k({ mode: 'auto' })],
});

const anime4k = art.plugins.artplayerPluginAnime4k;
anime4k.setMode('quality');
```

Without a bundler, load the browser build after ArtPlayer; it defines `artplayerPluginAnime4k`:

```html
<script src="https://cdn.jsdelivr.net/npm/artplayer/dist/artplayer.js"></script>
<script src="https://cdn.jsdelivr.net/npm/artplayer-plugin-anime4k"></script>
<script>
  const art = new Artplayer({
    container: '#player',
    url: 'episode.mp4',
    setting: true,
    plugins: [artplayerPluginAnime4k()],
  });
</script>
```

## Modes

All three presets are built from upstream Anime4K's **Mode A** - the mode Anime4K recommends for
most anime, which is mastered at 720p-1080p and blurred on the way to you.

| Mode          | Pipeline                                                                     | Use                               |
| ------------- | ---------------------------------------------------------------------------- | --------------------------------- |
| `off`         | -                                                                            | The plain `<video>`               |
| `performance` | `Deblur_DoG` > `Upscale_CNN_x2_M` > auto-downscale                           | Integrated GPUs, laptops          |
| `balanced`    | `Clamp_Highlights` > `Restore_CNN_M` > `Upscale_CNN_x2_M` > auto-downscale   | Mode A (Fast)                     |
| `quality`     | `Clamp_Highlights` > `Restore_CNN_VL` > `Upscale_CNN_x2_VL` > auto-downscale | Mode A (HQ), discrete GPUs        |
| `auto`        | The strongest of the three that fits the frame budget                        | The default; what most users want |

Each x2 step only runs when the screen is more than 1.2x the video on both axes, so a 1080p episode
in a 1080p window gets the restore / deblur step but no upscale.
Auto-downscale brings an overshoot (x2 of 720p is 1440p, too big for a 1080p screen) back down
with a proper filter instead of the final bilinear sample.

### How auto decides

1. Wait for the first decoded frame.
2. Run each preset, weakest first, on that frame at the real resolution and the real on-screen size: 3 warm-up frames, then the median of 7.
3. Pick the strongest preset whose median GPU time is **at most `frameBudgetMs` (8 ms)**. Stop measuring at the first miss - the stronger presets are slower still.
4. Cache the answer in `localStorage`, keyed by GPU, video resolution and screen size, for 30 days.

The benchmark takes well under a second on anything that passes it. A runtime downgrade overwrites
the cached answer, so a device that benchmarked optimistically does not repeat the mistake.

### When it steps down

The plugin judges playback in windows of 90 frames. A frame is bad when it took longer than
`slowFrameMs` (16 ms) on the GPU. Frames skipped because the previous one was still in flight, and
frames the browser reports as dropped, only count beyond 6 per window: players drop a few even on
a fast GPU. A window is bad when more than a quarter of it is bad.

Frames right after a (re)build, playback start, a seek, a stall or a tab switch drop on any GPU, so
those never count: the watch starts over on each of them, with 30 warm-up frames and 2 seconds in
which skipped and dropped frames are ignored. Nothing is watched while the tab is hidden.

What happens after **two bad windows in a row** depends on who chose the preset:

- **A preset the viewer picked** (`performance`, `balanced`, `quality`) is never lowered or turned
  off. It keeps rendering, and ArtPlayer shows `labels.struggling` once per source;
  `getStats().struggling` turns `true`.
- **Auto** steps down one preset and starts watching again. Its lowest preset, `performance`, only
  steps to `off` after **three** bad windows in a row. Apart from that, auto is only ever `off`
  when its benchmark found no preset that fits `frameBudgetMs`.

With `autoDowngrade: false`, auto keeps its preset too and shows the same notice. The cap is lifted
when the user picks a mode or the source changes.

### Audio sync

The upscaled frame reaches the screen after the plain one would have, by the GPU time for that frame:
about 8 ms for `performance` up to 40 ms or more for `quality` on an integrated GPU. From about
45 ms on, viewers notice the sound running ahead of the picture.

With `syncAudio` (the default), the plugin measures that lag on every frame, takes the median of
the last 30 frames, and delays the video's audio by as much through Web Audio
(`video` -> `DelayNode` -> speakers). The delay changes slowly, at most 2% of real time, so a preset
switch never clicks or audibly bends the pitch. It is capped at 250 ms: a preset the viewer picked
whose picture trails by more than that gets the `labels.struggling` notice instead. With upscaling
off, the delay ramps back to 0.

What to know:

- The audio is only rerouted once a frame has been upscaled, which proves the video is readable
  (same-origin or CORS); Web Audio would play an unreadable one as silence. It also waits for the
  page's first user gesture, since an audio context cannot start before one.
- A media element can be routed through Web Audio only once, and for good. The plugin does it at
  most once per `<video>`, and a player created later on the same element reuses it. If your page
  already calls `createMediaElementSource` on the video itself, the plugin leaves the audio alone.
- The element's `volume` and `muted` apply as before.
- Skipped on iOS, where routing element audio through Web Audio is unreliable.

## Options

| Option            | Type                                       | Default                      | Description                                                                      |
| ----------------- | ------------------------------------------ | ---------------------------- | -------------------------------------------------------------------------------- |
| `mode`            | `Mode`                                     | `'auto'`                     | Starting mode                                                                    |
| `labels`          | `Partial<Anime4kLabels>`                   | English                      | Any of the user-facing strings (see below)                                       |
| `onModeChange`    | `(mode: Mode, active: ActiveMode) => void` | -                            | Selection or active preset changed (menu, API, auto settling, downgrade)         |
| `onError`         | `(error: unknown) => void`                 | -                            | Upscaling had to stop: cross-origin video, lost GPU device, build failure        |
| `setting`         | `boolean`                                  | `true`                       | Add the entry to ArtPlayer's settings menu (needs `setting: true` on the player) |
| `icon`            | `string`                                   | sparkles glyph               | SVG/HTML for the settings entry                                                  |
| `compare`         | `boolean`                                  | `false`                      | Start in split view: original on the left, upscaled on the right                 |
| `frameBudgetMs`   | `number`                                   | `8`                          | Auto's ceiling on median GPU time per frame                                      |
| `slowFrameMs`     | `number`                                   | `16`                         | Frames slower than this count against the current preset                         |
| `autoDowngrade`   | `boolean`                                  | `true`                       | Let auto step down when the GPU cannot keep up; a picked preset only warns       |
| `syncAudio`       | `boolean`                                  | `true`                       | Delay the audio by as much as the upscaled picture trails (see Audio sync)       |
| `maxOutputPixels` | `number`                                   | `3840 * 2160`                | Cap on the canvas backing store (the upscale target)                             |
| `cache`           | `boolean`                                  | `true`                       | Remember auto's benchmark per device in `localStorage`                           |
| `cacheKey`        | `string`                                   | `'artplayer-plugin-anime4k'` | `localStorage` key prefix                                                        |
| `debug`           | `boolean`                                  | `false`                      | Log benchmark numbers and downgrades to the console                              |

## API

`art.plugins.artplayerPluginAnime4k`:

| Member                      | Description                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `setMode(mode)`             | Select a mode; unknown values are ignored                                               |
| `getMode()`                 | The selected mode, `'auto'` included                                                    |
| `getActiveMode()`           | What is rendering now: auto's pick, auto's downgraded preset, or `'off'`                |
| `setCompare(on, position?)` | Split view on/off; `position` (0..1, default 0.5) is where the line sits                |
| `getCompare()`              | Whether the split view is on                                                            |
| `getStats()`                | `{ active, frameMs, native, target, upscaling, struggling, canvasLagMs, audioDelayMs }` |
| `supported`                 | WebGPU is usable (`false` until the check finishes)                                     |
| `ready`                     | `Promise<boolean>` resolving with `supported`; never rejects                            |
| `destroy()`                 | Remove the canvas and settings entry, free the GPU; also runs on `art.destroy()`        |

The plugin only reads `mode` at start-up. To remember a viewer's choice, store what `onModeChange`
reports and pass it back as `mode` next time.

## Translating

```ts
artplayerPluginAnime4k({
  labels: {
    setting: 'Hochskalierung',
    auto: 'Automatisch',
    off: 'Aus',
    performance: 'Leistung',
    balanced: 'Ausgewogen',
    quality: 'Qualität',
    autoActive: 'Automatisch ({mode})', // {mode} becomes the label of the preset auto chose
    unsupported: 'Nicht unterstützt',
    struggling: 'Hochskalierung ist für diese GPU zu aufwendig; wähle eine leichtere Stufe',
  },
});
```

With react-i18next, pass `t('player.anime4k.setting')` and friends; any label left out stays English.

## Same-origin and CORS

WebGPU copies each video frame into a texture, and browsers refuse to let a page read pixels from a
**cross-origin video that was not loaded with CORS**. For upscaling to work the video must either:

- come from the **same origin** as the page (for example through your own streaming proxy), or
- be served with `Access-Control-Allow-Origin` **and** loaded with `crossorigin="anonymous"`
  (`moreVideoAttr: { crossOrigin: 'anonymous' }` in ArtPlayer). For HLS, that applies to the
  playlist and every segment.

A tainted video does not break playback: the first frame fails with a `SecurityError`, the plugin
logs one warning, calls `onError`, switches that source to `off` and tries again on the next one.

## Browser support

WebGPU is required: see [caniuse.com/webgpu](https://caniuse.com/webgpu). Where it is missing
the settings entry is not added and `supported` is `false`. `requestVideoFrameCallback` is used
when present, with a `requestAnimationFrame` fallback.

Phones can run `performance`, but upscaling costs battery; `auto` will usually pick `off` or
`performance` there on its own.

## Get started (development)

Prerequisites: **Bun** (or Node 22+).

```bash
bun install
bun run dev        # demo page with ArtPlayer + hls.js -> http://localhost:5173/demo/
bun run test       # vitest: mode selection, downgrade, options, cache, layout
bun run build      # dist/index.js (ESM) + .d.ts, dist/artplayer-plugin-anime4k.js (browser global)
```

The demo takes any mp4 or m3u8 URL (`?url=...&mode=quality` works too) and shows the selected and
active mode live. `/demo/compare.html` is a side-by-side view: open an episode from your disk (or
drop it on the player), drag the split line, and switch modes to see what each one changes.

## Credits

[Anime4K](https://github.com/bloc97/Anime4K) by bloc97 ·
[Anime4K-WebGPU-Async](https://github.com/daika7ana/Anime4K-WebGPU-Async) by daika7ana ·
[ArtPlayer](https://github.com/zhw2590582/ArtPlayer) by Harvey Zhao. The settings icon is Lucide's
`sparkles` (ISC).

## Licence

[MIT](LICENSE).
