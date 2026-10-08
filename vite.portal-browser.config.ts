import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig({ root, plugins: [react(), tailwindcss()], resolve: { alias: [
  { find: "@tanstack/react-start/server", replacement: fileURLToPath(new URL("./tests/portal-browser-start-server-stub.ts", import.meta.url)) },
  { find: "@tanstack/react-start", replacement: fileURLToPath(new URL("./tests/portal-browser-serverfn-stub.ts", import.meta.url)) },
  { find: "@/lib/customer-communications.functions", replacement: fileURLToPath(new URL("./tests/templates-hub-stubs.ts", import.meta.url)) },
  { find: "@/lib/mitti-forms.functions", replacement: fileURLToPath(new URL("./tests/templates-hub-stubs.ts", import.meta.url)) },
  { find: "@/lib/owner-gates.functions", replacement: fileURLToPath(new URL("./tests/templates-hub-stubs.ts", import.meta.url)) },
  { find: "@/lib/portal.functions", replacement: fileURLToPath(new URL("./tests/portal-browser-functions-stub.ts", import.meta.url)) },
  { find: "@/lib/admin-records.functions", replacement: fileURLToPath(new URL("./tests/portal-browser-admin-records-stub.ts", import.meta.url)) },
  { find: "@/lib/pilot.functions", replacement: fileURLToPath(new URL("./tests/installer-intake-functions-stub.ts", import.meta.url)) },
  { find: "@/lib/bulk-import.functions", replacement: fileURLToPath(new URL("./tests/installer-intake-functions-stub.ts", import.meta.url)) },
  { find: "@/lib/installer-quote.functions", replacement: fileURLToPath(new URL("./tests/installer-intake-functions-stub.ts", import.meta.url)) },
  { find: "@/lib/ready-check-draft.functions", replacement: fileURLToPath(new URL("./tests/installer-intake-functions-stub.ts", import.meta.url)) },
  { find: "@/lib/onsite-ready-check.functions", replacement: fileURLToPath(new URL("./tests/installer-intake-functions-stub.ts", import.meta.url)) },
  { find: "@/lib/job-electrician.functions", replacement: fileURLToPath(new URL("./tests/installer-intake-functions-stub.ts", import.meta.url)) },
  { find: "@/lib/piisa-a3.functions", replacement: fileURLToPath(new URL("./tests/piisa-crew-functions-stub.ts", import.meta.url)) },
  { find: "@/integrations/supabase/client", replacement: fileURLToPath(new URL("./tests/portal-browser-supabase-stub.ts", import.meta.url)) },
  { find: "@/hooks/use-me", replacement: fileURLToPath(new URL("./tests/portal-browser-use-me-stub.ts", import.meta.url)) },
  { find: "./assignment", replacement: fileURLToPath(new URL("./tests/portal-browser-assignment-stub.tsx", import.meta.url)) },
  { find: "@tanstack/react-router", replacement: fileURLToPath(new URL("./tests/portal-browser-router-stub.tsx", import.meta.url)) },
  { find: /^@\//, replacement: `${root}/src/` },
] }, server: { host: "127.0.0.1", port: 4178, strictPort: true } });