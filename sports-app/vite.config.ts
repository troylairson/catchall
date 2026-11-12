import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Served from GitHub Pages at https://troylairson.github.io/catchall/sports/
  base: '/catchall/sports/',
  plugins: [react()],
  server: {
    port: 5174,
    // api-web.nhle.com sends no CORS headers, so in dev we proxy it.
    proxy: {
      '/nhl-api': {
        target: 'https://api-web.nhle.com',
        changeOrigin: true,
        followRedirects: true,
        rewrite: (p: string) => p.replace(/^\/nhl-api/, ''),
      },
    },
  },
  test: { environment: 'node', exclude: ['worker/**', 'node_modules/**'] },
} as any);
