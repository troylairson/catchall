import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Served from GitHub Pages at https://troylairson.github.io/catchall/guitar/
  base: '/catchall/guitar/',
  plugins: [react()],
  server: { port: 5173 },
  test: { environment: 'node' },
} as any);
