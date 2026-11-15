import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const bridge = process.env.BRIDGE_URL ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': bridge,
      '/ws': { target: bridge.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
