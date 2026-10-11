import { defineConfig } from 'vite';

// Mosaic Studio ships as a static site (GitHub Pages friendly).
// `base: './'` keeps every asset reference relative so the build works from
// any sub-path, e.g. https://user.github.io/mosaic-studio/
export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // The dev preview is proxied through an external https host.
    allowedHosts: true,
    hmr: { clientPort: 443, protocol: 'wss' },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 2048,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('pdfjs-dist')) return 'pdfjs';
          if (id.includes('pdf-lib')) return 'pdflib';
          if (id.includes('gifenc')) return 'gifenc';
          return undefined;
        },
      },
    },
  },
  worker: { format: 'es' },
});
