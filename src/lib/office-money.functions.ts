// Office O6 Money (decisions 230, 240, 243). Admin-only reads + the single VEEC spot-price entry.
// There is deliberately NO "record payment" server function here (decision 240): owner payments come from Stripe or Xero.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";
import { requireOfficeIdentity, officeTestJobIds } from "./qa-office-access.server";

const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const getMoneyMargins = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    return plain(await (await import("./office-money.server")).moneyMargins());
  });

export const getMoneyPayouts = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const role = await requireOfficeIdentity(context.supabase);
    const ids = role === "qa_office" ? await officeTestJobIds(context.supabase) : undefined;
    return plain(await (await import("./office-money.server")).moneyPayouts(ids));
  });

export const getMoneyInvoices = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    return plain(await (await import("./office-money.server")).moneyInvoices());
  });

export const getMoneyVeecs = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    return plain(await (await import("./office-money.server")).moneyVeecs());
  });

/** Money › VEECs: the one place the spot price is entered (audited; keeps the current-price setting in step). */
export const saveVeecSpotPrice = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ price: z.number().positive().max(999) }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase);
    return (await import("./office-money.server")).setVeecSpotPrice(Math.round(data.price * 100) / 100, context.userId);
  });
