import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import dts from 'vite-plugin-dts';
import path from 'path';

const isLibMode = process.env.npm_lifecycle_event === 'build:lib';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  return {
  plugins: [
    react(),
    tailwindcss(),
    ...(isLibMode
      ? [
          dts({
            include: ['src/plugin.ts', 'src/**/*.ts', 'src/**/*.tsx'],
            outDir: 'dist',
            rollupTypes: true,
            tsconfigPath: './tsconfig.app.json',
          }),
        ]
      : []),
  ],
  base: env.VITE_BASE_PATH || '/',
  // @codingame/monaco-vscode-* packages check process.env at import time.
  // Without this polyfill the app crashes silently in the browser.
  define: {
    'process.env': '{}',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5174,
    host: true,
    proxy: {
      '/api': {
        target: env.VITE_API_TARGET || 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  build: isLibMode
    ? {
        lib: {
          entry: path.resolve(__dirname, 'src/plugin.ts'),
          name: 'VolundrUI',
          formats: ['es', 'umd'],
          fileName: (format) =>
            format === 'es' ? 'volundr-ui.es.js' : 'volundr-ui.umd.cjs',
        },
        rollupOptions: {
          external: ['react', 'react-dom', 'react-router-dom'],
          output: {
            globals: {
              react: 'React',
              'react-dom': 'ReactDOM',
              'react-router-dom': 'ReactRouterDOM',
            },
          },
        },
        sourcemap: true,
        outDir: 'dist',
      }
    : {
        outDir: 'dist',
        sourcemap: false,
        minify: 'esbuild',
        target: 'es2020',
        chunkSizeWarningLimit: 500,
        rollupOptions: {
          output: {
            manualChunks: {
              'vendor-react': ['react', 'react-dom', 'react-router-dom'],
              'vendor-state': ['zustand'],
              'vendor-icons': ['lucide-react'],
            },
            assetFileNames: (assetInfo) => {
              const info = assetInfo.name?.split('.') ?? [];
              const ext = info[info.length - 1];
              if (/png|jpe?g|svg|gif|tiff|bmp|ico/i.test(ext)) {
                return `assets/images/[name]-[hash][extname]`;
              }
              if (/css/i.test(ext)) {
                return `assets/css/[name]-[hash][extname]`;
              }
              return `assets/[name]-[hash][extname]`;
            },
            chunkFileNames: 'assets/js/[name]-[hash].js',
            entryFileNames: 'assets/js/[name]-[hash].js',
          },
        },
      },
  preview: {
    port: 4174,
    host: true,
  },
};
});
