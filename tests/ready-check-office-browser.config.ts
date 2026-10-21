import { defineConfig } from 'vite';
import base from '../vite.portal-browser.config';
import { fileURLToPath } from 'node:url';
const file = (name: string) => fileURLToPath(new URL(name, import.meta.url));
export default defineConfig({ ...base, resolve: { alias: [
  { find: '@tanstack/react-start/server', replacement: file('./ready-check-office-browser-server.ts') },
  { find: '@/lib/estimate.functions', replacement: file('./ready-check-office-browser-stubs.ts') },
  { find: '@/lib/ready-check-booking-access.functions', replacement: file('./ready-check-office-browser-stubs.ts') },
  { find: '@tanstack/react-router', replacement: file('./ready-check-office-browser-router.tsx') },
  ...(Array.isArray(base.resolve?.alias) ? base.resolve.alias : []),
] }, server: { host: '127.0.0.1', port: 4186, strictPort: true } });