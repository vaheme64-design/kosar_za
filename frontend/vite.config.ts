import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// KPIMS frontend — Vite dev server binds port 3000 (the port exposed by the
// platform gateway) and proxies /api/* to the Express backend on port 4100.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 3000,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4100',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
