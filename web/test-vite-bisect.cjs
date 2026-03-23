const { createServer } = require('vite');
const http = require('http');
const path = require('path');

async function test(label, config) {
  let port = 5175 + Math.floor(Math.random() * 1000);
  const server = await createServer({
    root: process.cwd(),
    server: { port },
    configFile: false,
    ...config
  });
  await server.listen();
  await new Promise(r => setTimeout(r, 2000));

  return new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost', port, path: '/src/main.tsx',
      headers: { 'Accept': '*/*' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', async () => {
        const ct = res.headers['content-type'] || '';
        const ok = ct.includes('javascript');
        console.log(`${label}: ${ok ? 'JS ✓' : 'HTML ✗'}`);
        await server.close();
        resolve(ok);
      });
    });
    req.end();
  });
}

const baseResolve = {
  alias: { '@': path.resolve(process.cwd(), './src') },
  dedupe: ['vscode', '@codingame/monaco-vscode-api', 'monaco-editor']
};

(async () => {
  const react = require('@vitejs/plugin-react');
  const tailwindcss = require('@tailwindcss/vite');

  // Step 1: bare
  await test('1. bare + alias', {
    resolve: baseResolve,
    define: { 'process.env': '{}' },
  });

  // Step 2: + react plugin
  await test('2. + react', {
    plugins: [react()],
    resolve: baseResolve,
    define: { 'process.env': '{}' },
  });

  // Step 3: + tailwind
  await test('3. + tailwind', {
    plugins: [react(), tailwindcss()],
    resolve: baseResolve,
    define: { 'process.env': '{}' },
  });

  // Step 4: + vscode css plugin
  const vscodeCssPlugin = {
    name: 'load-vscode-css-as-string',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      const resolved = await this.resolve(source, importer, options);
      if (resolved && resolved.id.match(
        /node_modules\/(@codingame\/monaco-vscode|vscode|monaco-editor).*\.css$/
      )) {
        return { ...resolved, id: resolved.id + '?inline' };
      }
      return undefined;
    },
  };
  await test('4. + vscode-css-plugin', {
    plugins: [react(), tailwindcss(), vscodeCssPlugin],
    resolve: baseResolve,
    define: { 'process.env': '{}' },
  });

  // Step 5: + COEP headers plugin
  const headersPlugin = {
    name: 'configure-response-headers',
    apply: 'serve',
    configureServer: (server) => {
      server.middlewares.use((_req, res, next) => {
        res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        next();
      });
    },
  };
  await test('5. + headers plugin', {
    plugins: [react(), tailwindcss(), vscodeCssPlugin, headersPlugin],
    resolve: baseResolve,
    define: { 'process.env': '{}' },
  });

  // Step 6: + worker format
  await test('6. + worker es', {
    plugins: [react(), tailwindcss(), vscodeCssPlugin, headersPlugin],
    resolve: baseResolve,
    define: { 'process.env': '{}' },
    worker: { format: 'es' },
  });

  // Step 7: + optimizeDeps
  await test('7. + optimizeDeps', {
    plugins: [react(), tailwindcss(), vscodeCssPlugin, headersPlugin],
    resolve: baseResolve,
    define: { 'process.env': '{}' },
    worker: { format: 'es' },
    optimizeDeps: {
      include: [
        '@codingame/monaco-vscode-api',
        '@codingame/monaco-vscode-api/extensions',
      ],
    },
  });

  // Clean up test file
  require('fs').unlinkSync(__filename);
})();
