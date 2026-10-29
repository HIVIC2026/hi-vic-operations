// Office-only list of Jo's standard answers for AI replies (Jo 29 Oct 2026). Table ai_reply_answers is staged; until it is
// applied the list is the built-in starting answers, read-only, and saving says it is waiting for the database change.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin, WorkflowError } from "./workflow.server";
import { AI_SEED_ANSWERS, dedupeAnswers, type AiAnswer } from "./ai-answers.core";
import { isMissingDbObject } from "./schema-compat.core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = { from: (t: string) => any };
const WAITING = "Waiting for the database change";
export type AiAnswerRow = AiAnswer & { id?: string; active: boolean; sort: number };

const seedRows = (): AiAnswerRow[] => AI_SEED_ANSWERS.map((a, i) => ({ topic: a.topic, answer: a.answer, active: true, sort: i + 1 }));

export const listAiAnswers = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ answers: AiAnswerRow[]; available: boolean }> => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as unknown as Loose).from("ai_reply_answers").select("id, topic, answer, active, sort")
      .order("sort", { ascending: true }).order("updated_at", { ascending: true });
    if (error) {
      if (!isMissingDbObject(error)) console.error("listAiAnswers: read failed", error.message);
      return { answers: seedRows(), available: false };
    }
    // Applied but empty: show the starting answers (what the AI uses); the first save copies them in.
    const rows = dedupeAnswers((data ?? []) as AiAnswerRow[]);
    return { answers: rows.length ? rows : seedRows(), available: true };
  });

export const saveAiAnswer = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid().optional(), topic: z.string().trim().min(2).max(80),
    answer: z.string().trim().min(2).max(2000), active: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as Loose;
    const fail = (e: { code?: string; message?: string }) => new WorkflowError(isMissingDbObject(e) ? WAITING : (e.message ?? "Could not save"));
    const now = new Date().toISOString();
    const stamp = { topic: data.topic, answer: data.answer, active: data.active, updated_at: now, updated_by: context.userId };
    const { data: last, error: readError } = await db.from("ai_reply_answers").select("sort").order("sort", { ascending: false }).limit(1);
    if (readError) throw fail(readError);
    let top = (last as { sort: number }[] | null)?.[0]?.sort;
    // An empty table means the AI is using the starting answers: copy them in first (one insert), so saving one answer
    // never leaves the AI with only that one.
    if (top == null) {
      const seed = seedRows().map((r) => ({ topic: r.topic, answer: r.answer, active: true, sort: r.sort, updated_at: now, updated_by: context.userId }));
      const { error: seedError } = await db.from("ai_reply_answers").insert(seed);
      if (seedError) throw fail(seedError);
      top = seed.length;
    }
    if (data.id) {
      const { data: hit, error } = await db.from("ai_reply_answers").update(stamp).eq("id", data.id).select("id");
      if (error) throw fail(error);
      if (!((hit as { id: string }[] | null) ?? []).length) throw new WorkflowError("That answer no longer exists — refresh the page.");
      return { ok: true };
    }
    const sort = top + 1;
    const { error } = await db.from("ai_reply_answers").insert({ ...stamp, sort });
    if (error) throw fail(error);
    return { ok: true };
  });

export const removeAiAnswer = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as unknown as Loose).from("ai_reply_answers").delete().eq("id", data.id);
    if (error) throw new WorkflowError(isMissingDbObject(error) ? WAITING : error.message);
    return { ok: true };
  });

// Auto-send switch and its sample replies (Jo 30 Oct 2026). Office only.
export const getAutoSendState = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const s = await import("./ai-auto-send.server");
    const [on, samples] = await Promise.all([s.autoSendOn(), s.autoSendSamples()]);
    return { on, samples, needed: s.AUTO_SEND_SAMPLES_NEEDED };
  });

export const switchAutoSend = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ on: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    return (await import("./ai-auto-send.server")).switchAutoSend(data.on, context.userId);
  });
