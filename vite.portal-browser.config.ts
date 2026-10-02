import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig({ root, plugins: [react(), tailwindcss()], resolve: { alias: [
  { find: "@tanstack/react-start", replacement: fileURLToPath(new URL("./tests/portal-browser-serverfn-stub.ts", import.meta.url)) },
  { find: "@/lib/portal.functions", replacement: fileURLToPath(new URL("./tests/portal-browser-functions-stub.ts", import.meta.url)) },
  { find: "@/integrations/supabase/client", replacement: fileURLToPath(new URL("./tests/portal-browser-supabase-stub.ts", import.meta.url)) },
  { find: "@/hooks/use-me", replacement: fileURLToPath(new URL("./tests/portal-browser-use-me-stub.ts", import.meta.url)) },
  { find: /^@\//, replacement: `${root}/src/` },
] }, server: { host: "127.0.0.1", port: 4178, strictPort: true } });