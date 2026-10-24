// Office O5 Partners (decisions 229, 232, 249). Admin-only. Approvals, CII verification, notices, Mitti checks, rates,
// coverage and uploads reuse the existing guarded server functions; only the board/file reads, the LOGGED bank reveal
// and resolving a partner change request live here.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";

const uuid = z.string().uuid();
const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const getPartnersBoard = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    return plain(await (await import("./office-partners.server")).partnersBoard());
  });

export const getBusinessFile = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase);
    return plain(await (await import("./office-partners.server")).businessFile(data.businessId));
  });

/** "Show full details (logged)": every reveal writes an audit row first; if it can't be logged nothing is shown. */
export const revealPartnerBank = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase);
    return (await import("./office-partners.server")).revealBank(data.businessId, context.userId);
  });

export const resolvePartnerChangeRequest = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid, status: z.enum(["done", "declined"]), note: z.string().trim().max(500).default("") }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase);
    if (data.status === "declined" && data.note.length < 3) throw new Error("Give a short reason for declining.");
    return (await import("./office-partners.server")).resolveChangeRequest(data.id, data.status, data.note, context.userId);
  });
