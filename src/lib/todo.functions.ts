import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";

// Admin-only. Every source read fails loudly — a failed read must never look like "nothing to do".
export const getTodos = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { loadTodos } = await import("./todo.server");
    const items = await loadTodos(admin);
    return { items, checkedAt: new Date().toISOString() };
  });
