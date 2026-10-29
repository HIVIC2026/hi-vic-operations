// Jo's standard answers for AI replies (Jo 29 Oct 2026). Reads the staged ai_reply_answers table; until it is applied,
// or while it is empty or unreadable, the built-in seed answers are used. Never throws.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_SEED_ANSWERS, dedupeAnswers, type AiAnswer } from "./ai-answers.core";
import { isMissingDbObject } from "./schema-compat.core";

const loose = admin as unknown as SupabaseClient;

export async function loadAiAnswers(): Promise<{ answers: AiAnswer[]; available: boolean }> {
  try {
    const { data, error } = await loose.from("ai_reply_answers").select("topic, answer, active, sort, updated_at")
      .eq("active", true).order("sort", { ascending: true }).order("updated_at", { ascending: true });
    if (error) {
      if (isMissingDbObject(error)) return { answers: AI_SEED_ANSWERS, available: false };
      console.error("loadAiAnswers: read failed, using the built-in answers", error.message);
      return { answers: AI_SEED_ANSWERS, available: false };
    }
    const rows = dedupeAnswers(((data ?? []) as { topic: string; answer: string; active?: boolean }[]).filter((r) => r.active !== false)
      .map((r) => ({ topic: r.topic, answer: r.answer })));
    return { answers: rows.length ? rows : AI_SEED_ANSWERS, available: true };
  } catch (e) {
    console.error("loadAiAnswers: read failed, using the built-in answers", e instanceof Error ? e.message : e);
    return { answers: AI_SEED_ANSWERS, available: false };
  }
}
