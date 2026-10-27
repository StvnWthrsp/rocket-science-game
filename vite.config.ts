import { defineConfig } from 'vite';

export default defineConfig(() => ({
  base: process.env.GITHUB_ACTIONS ? '/rocket-science-game/' : '/',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1400,
  },
}));
