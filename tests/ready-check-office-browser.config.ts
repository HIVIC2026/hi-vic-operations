import { defineConfig, mergeConfig } from 'vite';
import base from '../vite.portal-browser.config';
import { fileURLToPath } from 'node:url';
const file = (name: string) => fileURLToPath(new URL(name, import.meta.url));
export default mergeConfig(base, defineConfig({ resolve: { alias: [
  { find: '@/lib/estimate.functions', replacement: file('./ready-check-office-browser-stubs.ts') },
  { find: '@/lib/ready-check-booking-access.functions', replacement: file('./ready-check-office-browser-stubs.ts') },
  { find: '@tanstack/react-router', replacement: file('./ready-check-office-browser-router.tsx') },
] }, server: { port: 4186 } }));