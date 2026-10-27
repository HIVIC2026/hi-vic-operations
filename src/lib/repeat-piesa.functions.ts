import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";

const uuid = z.string().uuid();

export const repeatPiesaOfficeState = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const m = await import("./repeat-piesa.server");
    const [{ state, suggestion }, price] = await Promise.all([m.repeatPiesaContext(data.jobId), m.repeatPiesaPrice()]);
    return { state, suggestion, price };
  });

export const chooseRepeatPiesaPayerFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, payer: z.enum(["owner", "installer", "hivic"]) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    return (await import("./repeat-piesa.server")).chooseRepeatPayer(data.jobId, data.payer, context.userId);
  });

export const recordRepeatPiesaPaidFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, reference: z.string().trim().min(2).max(120) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    return (await import("./repeat-piesa.server")).recordRepeatPiesaPaid(data.jobId, context.userId, data.reference);
  });

export const getRepeatPiesaPriceFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    return { price: await (await import("./repeat-piesa.server")).repeatPiesaPrice() };
  });

export const setRepeatPiesaPriceFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ price: z.number().positive().max(5000).nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    return { price: await (await import("./repeat-piesa.server")).setRepeatPiesaPrice(data.price, context.userId) };
  });
