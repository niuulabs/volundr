import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5175,
    host: true,
    proxy: {
      '/mimir': {
        target: process.env.VITE_MIMIR_TARGET || 'http://localhost:7477',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    target: 'esnext',
    sourcemap: false,
    minify: 'esbuild',
  },
  preview: {
    port: 4175,
    host: true,
  },
});
