import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
const root = process.cwd();
const server = await createServer({ root, configFile: false, plugins: [react(), tailwind()], resolve: { alias: [
  { find: '@tanstack/react-start', replacement: root + '/tests/portal-browser-serverfn-stub.ts' },
  { find: '@/lib/trade-view.functions', replacement: root + '/tests/usual-electrician-browser-functions.ts' },
  { find: './business-pages', replacement: root + '/tests/usual-electrician-browser-fields.ts' },
  { find: '@', replacement: root + '/src' },
] }, server: { host: '127.0.0.1', port: 8097, strictPort: true } });
await server.listen();
console.log('Sealed usual electrician form on 8097; no backend/provider access.');