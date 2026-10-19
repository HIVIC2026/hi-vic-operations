// D-7: side-effect import that switches on the LOCAL UAT network guard (see local-network-guard.ts).
// Imported first by src/router.tsx (browser + server) and src/server.ts (server). In production none of the
// triggering values are present, so this does nothing there.
import { installLocalNetworkGuard } from "./local-network-guard";

const viteEnv = ((import.meta as unknown as { env?: Record<string, unknown> }).env ?? {}) as Record<string, unknown>;
const procEnv: Record<string, string | undefined> = typeof process !== "undefined" && process?.env ? process.env : {};
const pick = (k: string) => procEnv[k] ?? (typeof viteEnv[k] === "string" ? (viteEnv[k] as string) : undefined);

export const localNetworkGuardActive = installLocalNetworkGuard({
  HIVIC_LOCAL_UAT: pick("HIVIC_LOCAL_UAT"),
  VITE_HIVIC_LOCAL_UAT: pick("VITE_HIVIC_LOCAL_UAT"),
  HIVIC_LOCAL_SUPABASE: pick("HIVIC_LOCAL_SUPABASE"),
  SUPABASE_URL: pick("SUPABASE_URL"),
  VITE_SUPABASE_URL: pick("VITE_SUPABASE_URL"),
});
