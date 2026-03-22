import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import dts from 'vite-plugin-dts';
import importMetaUrlPlugin from '@codingame/esbuild-import-meta-url-plugin';
import path from 'path';
import fs from 'fs';

// Discover all @codingame/monaco-vscode-* packages for optimizeDeps.include.
// Matching the demo: pre-bundle ALL @codingame packages (including default extensions).
// The esbuild-import-meta-url-plugin handles `new URL('./resources/...', import.meta.url)`
// patterns during pre-bundling so resource files resolve correctly from .vite/deps/.
const codingameDir = path.resolve(__dirname, 'node_modules/@codingame');
const codingamePackages = fs.existsSync(codingameDir)
  ? fs.readdirSync(codingameDir)
      .filter((name) => name.startsWith('monaco-vscode'))
      .map((name) => `@codingame/${name}`)
  : [];

const isLibMode = process.env.npm_lifecycle_event === 'build:lib';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  return {
  plugins: [
    react(),
    tailwindcss(),
    // Force VS Code CSS to be loaded inline rather than extracted.
    // Without this, VS Code's internal CSS (tree views, sidebar panels,
    // editor tabs, etc.) doesn't get applied and panels render as empty boxes.
    {
      name: 'load-vscode-css-as-string',
      enforce: 'pre' as const,
      async resolveId(source, importer, options) {
        const resolved = await this.resolve(source, importer, options);
        if (
          resolved?.id.match(
            /node_modules\/(@codingame\/monaco-vscode|vscode|monaco-editor).*\.css$/
          )
        ) {
          return { ...resolved, id: resolved.id + '?inline' };
        }
        return undefined;
      },
    },
    // SharedArrayBuffer requires cross-origin isolation headers.
    // Needed for language-features extensions in dev mode.
    {
      name: 'configure-response-headers',
      apply: 'serve' as const,
      configureServer: (server) => {
        server.middlewares.use((_req, res, next) => {
          res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
          res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
          res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
          next();
        });
      },
    },
    ...(isLibMode
      ? [
          dts({
            include: ['src/plugin.ts', 'src/**/*.ts', 'src/**/*.tsx'],
            outDir: 'dist',
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
    '__APP_VERSION__': JSON.stringify(
      process.env.VITE_APP_VERSION || process.env.npm_package_version || 'dev'
    ),
  },
  // Workers from @codingame/monaco-vscode-* use code-splitting, which
  // requires ES module format (IIFE is the Vite default and doesn't support it).
  worker: {
    format: 'es',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    // Prevent multiple copies of VS Code modules from being loaded.
    dedupe: ['vscode', '@codingame/monaco-vscode-api', 'monaco-editor'],
  },
  // Pre-bundle ALL @codingame packages (matching demo pattern).
  // The esbuild-import-meta-url-plugin handles import.meta.url patterns
  // for default-extension resource files during pre-bundling.
  optimizeDeps: {
    include: [
      ...codingamePackages,
      '@codingame/monaco-vscode-api/extensions',
      '@codingame/monaco-vscode-api/monaco',
      '@codingame/monaco-vscode-extension-api/localExtensionHost',
    ],
    exclude: [],
    esbuildOptions: {
      plugins: [importMetaUrlPlugin],
    },
  },
  server: {
    port: 5174,
    host: true,
    proxy: {
      '/api/tracker': {
        target: env.VITE_TYR_API_TARGET || 'http://localhost:8081',
        changeOrigin: true,
      },
      '/api': {
        target: env.VITE_API_TARGET || 'http://localhost:8080',
        changeOrigin: true,
      },
      '/s/': {
        target: env.VITE_API_TARGET || 'http://localhost:8080',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: isLibMode
    ? {
        lib: {
          entry: path.resolve(__dirname, 'src/plugin.ts'),
          formats: ['es'],
          fileName: () => 'volundr-ui.es.js',
        },
        rollupOptions: {
          external: ['react', 'react-dom', 'react-router-dom'],
        },
        sourcemap: false,
        outDir: 'dist',
      }
    : {
        outDir: 'dist',
        target: 'esnext',
        sourcemap: false,
        minify: 'esbuild',
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
