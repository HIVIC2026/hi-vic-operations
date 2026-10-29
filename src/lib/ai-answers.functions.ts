// Office-only list of Jo's standard answers for AI replies (Jo 29 Oct 2026). Table ai_reply_answers is staged; until it is
// applied the list is the built-in starting answers, read-only, and saving says it is waiting for the database change.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin, WorkflowError } from "./workflow.server";
import { AI_SEED_ANSWERS, type AiAnswer } from "./ai-answers.core";
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
    return { answers: (data ?? []) as AiAnswerRow[], available: true };
  });

export const saveAiAnswer = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid().optional(), topic: z.string().trim().min(2).max(80),
    answer: z.string().trim().min(2).max(2000), active: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as Loose;
    const fail = (e: { code?: string; message?: string }) => new WorkflowError(isMissingDbObject(e) ? WAITING : (e.message ?? "Could not save"));
    const stamp = { topic: data.topic, answer: data.answer, active: data.active, updated_at: new Date().toISOString(), updated_by: context.userId };
    if (data.id) {
      const { error } = await db.from("ai_reply_answers").update(stamp).eq("id", data.id);
      if (error) throw fail(error);
      return { ok: true };
    }
    const { data: last, error: readError } = await db.from("ai_reply_answers").select("sort").order("sort", { ascending: false }).limit(1);
    if (readError) throw fail(readError);
    const sort = ((last as { sort: number }[] | null)?.[0]?.sort ?? 0) + 1;
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
