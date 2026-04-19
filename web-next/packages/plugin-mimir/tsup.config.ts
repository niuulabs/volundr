import { defineConfig } from 'tsup';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function concatCssFiles(dir: string): string {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(p);
      } else if (entry.isFile() && p.endsWith('.css')) {
        out.push(`/* ${p} */\n${readFileSync(p, 'utf8')}`);
      }
    }
  };
  walk(dir);
  return out.join('\n\n');
}

export default defineConfig({
  entry: ['src/index.tsx'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    'react',
    '@tanstack/react-query',
    '@tanstack/react-router',
    '@niuulabs/plugin-sdk',
    '@niuulabs/query',
    '@niuulabs/ui',
    '@niuulabs/domain',
  ],
  onSuccess: async () => {
    writeFileSync('dist/styles.css', concatCssFiles('src'));
  },
});
