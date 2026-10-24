// O7 Settings (decisions 15/60, 159, 16, 246, 248). Admin-only. Reads + flipping one office switch (audited, CAS).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";

const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const getOfficeSwitches = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    return plain(await (await import("./office-settings.server")).officeSwitches());
  });

export const setOfficeSwitch = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ key: z.string().min(1).max(80), on: z.boolean(), expected: z.boolean(), reason: z.string().trim().min(3).max(300) }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase);
    return (await import("./office-settings.server")).setOfficeSwitch(data.key, data.on, data.expected, data.reason, context.userId);
  });

export const getMessageRegister = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    return (await import("./office-settings.server")).messageRegister();
  });

export const getXeroPaymentsHealth = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    return (await import("./office-settings.server")).xeroPaymentsHealth();
  });
