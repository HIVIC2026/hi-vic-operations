// Office RPCs for Mitti auto-invite (decision 188): read the open invite list on Staff approvals and confirm, per person,
// that the invite/group/templates were done in Mitti. Admin-only; nothing here creates a Mitti user or sends a message.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";

const uuid = z.string().uuid();

export const listMittiInvites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const { listOpenMittiInvites } = await import("./mitti-invite.server");
    return listOpenMittiInvites();
  });

export const confirmMittiInviteDoneFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ workerId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { confirmMittiInviteDone } = await import("./mitti-invite.server");
    return confirmMittiInviteDone(data.workerId, context.userId);
  });
