// Standalone browser-only Vite, never the running portal server.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = process.cwd();
export default defineConfig({ root, cacheDir: 'node_modules/.vite-portal-isolated', plugins: [
  { name: 'isolated-boundaries', enforce: 'pre', configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.headers.accept?.includes('text/html') && req.url && !req.url.includes('.')) req.url = '/tests/portal-isolated/index.html';
      next();
    });
  }, resolveId(source, importer) {
    if (/\.functions(?:\.ts)?$/.test(source)) {
      const path = source.startsWith('@/') ? resolve(root, 'src', source.slice(2)) : resolve(importer ? resolve(importer, '..') : root, source);
      return '\0qa-functions:' + path.replace(/\.ts$/, '') + '.ts';
    }
    if (/\.server(?:\.[jt]sx?)?$/.test(source) || source.includes('integrations/supabase/client.server')) throw new Error('ISOLATED_QA_SERVER_IMPORT_REFUSED: ' + source);
    return null;
  }, load(id) {
    if (!id.startsWith('\0qa-functions:')) return null;
    const src = readFileSync(id.slice('\0qa-functions:'.length), 'utf8');
    const names = [...src.matchAll(/export\s+(?:async\s+)?(?:const|function)\s+(\w+)/g)].map(m => m[1]);
    return `import { callFixture } from '/tests/portal-isolated/fixtures.ts';\n` + names.map(name => `export const ${name} = Object.assign((args)=>callFixture(${JSON.stringify(name)},args),{__mockName:${JSON.stringify(name)}});`).join('\n');
  } }, react(), tailwindcss(),
], resolve: { alias: [
  { find: '@tanstack/react-start', replacement: resolve(root, 'tests/portal-isolated/start.ts') },
  { find: '@/integrations/supabase/client', replacement: resolve(root, 'tests/portal-isolated/client.ts') },
  { find: '@/hooks/use-me', replacement: resolve(root, 'tests/portal-isolated/use-me.ts') },
  { find: '@/lib/route-guards', replacement: resolve(root, 'tests/portal-isolated/guards.ts') },
  { find: /^@\//, replacement: root + '/src/' },
] }, server: { host: '127.0.0.1', port: 4186, strictPort: true }, envPrefix: 'ISOLATED_PUBLIC_' });