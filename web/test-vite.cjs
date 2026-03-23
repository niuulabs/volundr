const { createServer } = require('vite');
const http = require('http');
const path = require('path');

(async () => {
  // Test with the actual config file first
  const server = await createServer({
    root: process.cwd(),
    server: { port: 5174 },
  });
  await server.listen();
  await new Promise(r => setTimeout(r, 5000));
  
  const req = http.request({
    hostname: 'localhost', port: 5174, path: '/src/main.tsx',
    headers: { 'Accept': '*/*' }
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', async () => {
      const ct = res.headers['content-type'] || '';
      console.log('With vite.config.ts:');
      console.log('  Content-Type:', ct);
      console.log('  Is JS:', ct.includes('javascript'));
      console.log('  First 80:', data.substring(0, 80));
      await server.close();

      // Now test WITHOUT config file
      const server2 = await createServer({
        root: process.cwd(),
        server: { port: 5175 },
        configFile: false,
        plugins: [],
        resolve: {
          alias: { '@': path.resolve(process.cwd(), './src') }
        },
        define: { 'process.env': '{}' },
      });
      await server2.listen();
      await new Promise(r => setTimeout(r, 3000));

      const req2 = http.request({
        hostname: 'localhost', port: 5175, path: '/src/main.tsx',
        headers: { 'Accept': '*/*' }
      }, (res2) => {
        let data2 = '';
        res2.on('data', chunk => data2 += chunk);
        res2.on('end', async () => {
          const ct2 = res2.headers['content-type'] || '';
          console.log('\nWithout vite.config.ts (bare + alias):');
          console.log('  Content-Type:', ct2);
          console.log('  Is JS:', ct2.includes('javascript'));
          console.log('  First 80:', data2.substring(0, 80));
          await server2.close();
        });
      });
      req2.end();
    });
  });
  req.end();
})();
