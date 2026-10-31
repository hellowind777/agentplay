import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { agentplayI18n } from './src/i18n/vite-plugin';

// `base: './'` keeps every asset URL relative, so the built `dist/` can be
// served from any path (the Python CLI mounts it wherever it likes).
// `AGENTPLAY_SERVER` proxies `/api` to a running `agentplay` server in dev.
const server = process.env.AGENTPLAY_SERVER;

export default defineConfig({
  base: './',
  // i18n first: inject `t()` calls into dictionary-listed strings before
  // anything else touches the module. See src/i18n/vite-plugin.ts.
  plugins: [agentplayI18n(), react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: server ? { proxy: { '/api': server } } : undefined,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
  },
  test: {
    environment: 'jsdom',
    // Non-UTC on purpose: the server speaks UTC dates, so local-time bugs show.
    env: { TZ: 'America/Los_Angeles' },
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    // Tests assert English strings; pin the language so an zh-CN OS does not
    // flip the injected translations under them.
    setupFiles: ['src/i18n/test-setup.ts'],
  },
});
