import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
const root = process.cwd();
const aliases = [
  { find: '@tanstack/react-start', replacement: root + '/tests/portal-browser-serverfn-stub.ts' },
  { find: '@tanstack/react-router', replacement: root + '/tests/portal-browser-router-stub.tsx' },
  { find: /^@\/integrations\/supabase\/client$/, replacement: root + '/tests/portal-browser-supabase-stub.ts' },
  { find: /^@\/lib\/(pilot|bulk-import|job-electrician|installer-quote|ready-check-draft|installer-journey)\.functions$/, replacement: root + '/tests/installer-intake-functions-stub.ts' },
  { find: /^@\/components\/portal\/panels$/, replacement: root + '/tests/save-feedback-panels-stub.tsx' },
  { find: '@', replacement: root + '/src' },
];
const server = await createServer({ root, configFile: false, plugins: [react(), tailwind()], resolve: { alias: aliases }, server: { host: '127.0.0.1', port: 8096, strictPort: true } });
await server.listen();
console.log('Sealed cross-screen save checks on 8096');