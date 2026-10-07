// "How job offers go out" setting (Jo, 7 Oct 2026). Office picks first is the launch default.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getDispatchSettings, setDispatchMode } from "@/lib/offer-dispatch.functions";

export function DispatchModeSwitch() {
  const qc = useQueryClient();
  const load = useServerFn(getDispatchSettings);
  const save = useServerFn(setDispatchMode);
  const q = useQuery({ queryKey: ["dispatch-mode"], queryFn: () => load() });
  if (!q.data) return null;
  const set = async (mode: "office_picks" | "automatic") => {
    try { await save({ data: { mode } }); toast.success("Saved"); void qc.invalidateQueries(); } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't save"); }
  };
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[18px] border bg-card p-3 text-sm" role="group" aria-label="How job offers go out">
      <span className="font-semibold">How job offers go out:</span>
      <Button size="sm" variant={q.data.mode !== "automatic" ? "default" : "outline"} onClick={() => void set("office_picks")}>Office picks first</Button>
      <Button size="sm" variant={q.data.mode === "automatic" ? "default" : "outline"} onClick={() => void set("automatic")}>Automatic</Button>
      <span className="text-xs text-muted-foreground">{q.data.mode === "automatic" ? "Ready Check and safety-check offers go to all matching trades." : "Ready Check and safety-check offers wait here until you choose trades."} “Suggest another time” opens after {q.data.suggestHours}h.</span>
    </div>
  );
}
