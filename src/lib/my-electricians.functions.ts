import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const path = z.string().trim().max(500);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (n: number) => z.string().trim().max(n);

export const getMyElectricians = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { installerMyElectricians } = await import("./my-electricians.server");
    return installerMyElectricians(context.userId);
  });

export const getMyElectricianUploadUrl = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ kind: z.enum(["licence", "pl", "workcover"]), fileName: z.string().trim().min(1).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const { myElectricianUploadUrl } = await import("./my-electricians.server");
    return myElectricianUploadUrl(context.userId, data.kind, data.fileName);
  });

export const addMyElectrician = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    name: text(200), email: text(254), mobile: text(30), recNumber: text(60), licenceNumber: text(60), licenceExpiry: day.or(z.literal("")),
    licenceFilePath: path, plFilePath: path, plAmount: z.number().finite().min(0).max(1_000_000_000), plExpiry: day.or(z.literal("")),
    employsAnyone: z.boolean(), workcoverFilePath: path.nullish(), workcoverExpiry: day.or(z.literal("")).nullish(), soleTraderTick: z.boolean().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { installerAddElectrician } = await import("./my-electricians.server");
    return installerAddElectrician(context.userId, {
      ...data, workcoverFilePath: data.workcoverFilePath ?? null, workcoverExpiry: data.workcoverExpiry || null, soleTraderTick: data.soleTraderTick ?? false,
    });
  });
