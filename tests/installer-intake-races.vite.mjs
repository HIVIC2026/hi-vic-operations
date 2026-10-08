// Sealed regression server. Run from project root; no real server/storage calls.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
const root = process.cwd();
const aliases = [
  { find: '@tanstack/react-start', replacement: `${root}/tests/portal-browser-serverfn-stub.ts` },
  { find: '@tanstack/react-router', replacement: `${root}/tests/portal-browser-router-stub.tsx` },
  { find: /^@\/integrations\/supabase\/client$/, replacement: `${root}/tests/portal-browser-supabase-stub.ts` },
  { find: /^@\/lib\/(pilot|bulk-import|job-electrician|installer-quote)\.functions$/, replacement: `${root}/tests/installer-intake-functions-stub.ts` },
  { find: '@', replacement: `${root}/src` },
];
const server = await createServer({ root, configFile: false, plugins: [react(), tailwind()], resolve: { alias: aliases }, server: { host: '127.0.0.1', port: 8091, strictPort: true } });
await server.listen();
console.log('Sealed installer intake fixture ready on localhost:8091');
