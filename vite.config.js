import { resolve } from 'node:path';

import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        waterwingBlenderForward: resolve(import.meta.dirname, 'waterwing-blender-forward.html'),
      }
    }
  }
});
