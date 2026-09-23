import Artplayer from 'artplayer';
import Hls from 'hls.js';
import artplayerPluginAnime4k, { type Anime4kPlugin, type Mode } from '../src/index';

// Mux's public test stream: CORS-enabled, HLS with several renditions (good for quality switches).
const DEFAULT_URL = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const urlInput = $<HTMLInputElement>('url');
const modeSelect = $<HTMLSelectElement>('mode');
const params = new URLSearchParams(location.search);
urlInput.value = params.get('url') ?? DEFAULT_URL;
modeSelect.value = params.get('mode') ?? 'auto';

let art: Artplayer | null = null;

function show(id: string, text: string): void {
  $(id).textContent = text;
}

function playM3u8(video: HTMLVideoElement, url: string, player: Artplayer): void {
  if (Hls.isSupported()) {
    const hls = new Hls();
    hls.loadSource(url);
    hls.attachMedia(video);
    player.on('destroy', () => hls.destroy());
  } else {
    video.src = url;
  }
}

function load(url: string, mode: Mode): void {
  art?.destroy(false);
  art = new Artplayer({
    container: '#player',
    url,
    type: url.includes('.m3u8') ? 'm3u8' : '',
    customType: { m3u8: playM3u8 },
    setting: true,
    fullscreen: true,
    fullscreenWeb: true,
    aspectRatio: true,
    flip: true,
    muted: true,
    autoplay: true,
    // `?cors=0` loads without crossorigin, to see the tainted-video fallback.
    moreVideoAttr: params.get('cors') === '0' ? {} : { crossOrigin: 'anonymous' },
    plugins: [
      artplayerPluginAnime4k({
        mode,
        debug: true,
        // `?sync=0` leaves the audio undelayed, to compare.
        syncAudio: params.get('sync') !== '0',
        onModeChange(selected, active) {
          show('selected', selected);
          show('active', active);
          show('event', `onModeChange(${selected}, ${active})`);
          modeSelect.value = selected;
        },
        onError(error) {
          show('event', `onError: ${error instanceof Error ? error.message : String(error)}`);
        },
      }),
    ],
  });

  const plugin = art.plugins.artplayerPluginAnime4k as Anime4kPlugin;
  (window as unknown as { anime4k: Anime4kPlugin }).anime4k = plugin;
  show('selected', plugin.getMode());
  show('active', plugin.getActiveMode());
  show('supported', 'checking...');
  void plugin.ready.then((supported) => {
    show('supported', supported ? 'available' : 'unavailable - plugin stays off');
    show('active', plugin.getActiveMode());
  });
  art.video.addEventListener('resize', () => {
    show('resolution', `${art?.video.videoWidth}x${art?.video.videoHeight}`);
  });
}

$('source').addEventListener('submit', (event) => {
  event.preventDefault();
  load(urlInput.value, modeSelect.value as Mode);
});

modeSelect.addEventListener('change', () => {
  const plugin = art?.plugins.artplayerPluginAnime4k as Anime4kPlugin | undefined;
  plugin?.setMode(modeSelect.value as Mode);
});

$('clear-cache').addEventListener('click', () => {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('artplayer-plugin-anime4k:')) localStorage.removeItem(key);
    }
    show('event', 'benchmark cache cleared');
  } catch {
    show('event', 'localStorage unavailable');
  }
});

load(urlInput.value, modeSelect.value as Mode);
