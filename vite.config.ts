import { defineConfig } from 'vitest/config';

// `tsc` emits the ESM build and the types (dist/index.js + .d.ts). Vite only produces the
// single-file browser global, `artplayerPluginAnime4k`, for a plain <script> tag - the same shape
// as the official ArtPlayer plugins. Everything, the Anime4K shaders included, is inlined into it.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: 'src/global.ts',
      name: 'artplayerPluginAnime4k',
      formats: ['iife'],
      fileName: () => 'artplayer-plugin-anime4k.js',
    },
    rolldownOptions: {
      output: {
        exports: 'default',
      },
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
