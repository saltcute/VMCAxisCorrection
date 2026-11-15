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
  // OBS's dock browser is an older Chromium (CEF), so don't emit the newest syntax.
  build: { outDir: 'dist', emptyOutDir: true, target: 'chrome95' },
});
