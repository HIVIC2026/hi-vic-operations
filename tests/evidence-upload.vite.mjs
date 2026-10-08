import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
const root = process.cwd();
const server = await createServer({ root, configFile: false, plugins: [react(), tailwind()], resolve: { alias: [
  { find: '@tanstack/react-start', replacement: `${root}/tests/portal-browser-serverfn-stub.ts` },
  { find: '@tanstack/react-router', replacement: `${root}/tests/portal-browser-router-stub.tsx` },
  { find: /^@\/integrations\/supabase\/client$/, replacement: `${root}/tests/portal-browser-supabase-stub.ts` },
  { find: /^@\/lib\/(portal|admin-records)\.functions$/, replacement: `${root}/tests/portal-browser-functions-stub.ts` },
  { find: /^\.\/(assignment|rectification-times)$/, replacement: `${root}/tests/evidence-unrendered-stub.tsx` },
  { find: '@', replacement: `${root}/src` },
] }, server: { host: '127.0.0.1', port: 8093, strictPort: true } });
await server.listen();
console.log('Sealed evidence fixture on localhost:8093');