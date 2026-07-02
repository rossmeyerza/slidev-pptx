import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:4321',
      '/auth': 'http://127.0.0.1:4321',
      '/draft': 'http://127.0.0.1:4321',
      '/published': 'http://127.0.0.1:4321',
      '/share': 'http://127.0.0.1:4321',
      '/vendor': 'http://127.0.0.1:4321',
    },
  },
});
