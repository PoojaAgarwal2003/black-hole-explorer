import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/artifacts/**', '**/wallpaper/**'] },
  },
  preview: { port: 4173, strictPort: true },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three', 'three/addons/controls/OrbitControls.js'],
        },
      },
    },
  },
});
