// Jo 27 Oct 2026: edits to an AI reply draft save as she types, so a refresh keeps them. Never sends.
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { saveAiReplyDraftEdit } from "@/lib/ai-email-reply.functions";

export type SaveState = "idle" | "saving" | "saved" | "failed";

export function useDraftAutosave(eventId: string | null, body: string | null, loaded: string | null): SaveState {
  const save = useServerFn(saveAiReplyDraftEdit);
  const [state, setState] = useState<SaveState>("idle");
  const last = useRef<string | null>(loaded);
  useEffect(() => { if (last.current === null) last.current = loaded; }, [loaded]);
  useEffect(() => {
    if (!eventId || body === null || body === last.current) return;
    const t = setTimeout(() => {
      setState("saving");
      save({ data: { eventId, body } })
        .then(() => { last.current = body; setState("saved"); })
        .catch(() => setState("failed"));
    }, 800);
    return () => clearTimeout(t);
  }, [eventId, body, save]);
  return state;
}

export function saveStateText(s: SaveState): string | null {
  return s === "saving" ? "Saving…" : s === "saved" ? "Saved" : s === "failed" ? "Your edit didn't save. Keep typing to try again." : null;
}
