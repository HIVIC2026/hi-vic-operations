import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getHotLeads = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { requireAdmin } = await import("./workflow.server");
  await requireAdmin(context.supabase);
  return (await import("./hot-leads.server")).loadHotLeads();
});