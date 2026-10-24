// Coverage edit (decision 229), shared by Partners › Coverage and the business file. Saves through the existing
// saveBusiness (Victorian postcodes validated server-side; verify_coverage records the office verification).
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Btn, fieldInput } from "@/components/portal/kit";
import { saveBusiness } from "@/lib/pilot.functions";

/** Coverage edit: saves through saveBusiness (postcodes validated as Victorian; saving here also verifies them). */
export function CoverageDialog({ row, onClose }: { row: { id: string; name: string; rawName: string; regions: string[]; postcodeList: string[] }; onClose: () => void }) {
  const save = useServerFn(saveBusiness);
  const qc = useQueryClient();
  const [regions, setRegions] = useState(row.regions.join(", "));
  const [postcodes, setPostcodes] = useState(row.postcodeList.join(" "));
  const [busy, setBusy] = useState(false);
  const list = postcodes.split(/[\s,]+/).map((p) => p.trim()).filter(Boolean);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Coverage · {row.name}</DialogTitle><DialogDescription>Suburbs are for reading; postcodes are what matching uses. Saving records the postcodes as office-verified.</DialogDescription></DialogHeader>
        <label className="text-xs font-semibold">Areas and suburbs<textarea className={`${fieldInput} mt-1`} rows={2} value={regions} onChange={(e) => setRegions(e.target.value)} /></label>
        <label className="text-xs font-semibold">Postcodes (Victorian, e.g. 3145 3150 or 31*)<textarea className={`${fieldInput} mt-1`} rows={3} value={postcodes} onChange={(e) => setPostcodes(e.target.value)} /></label>
        <DialogFooter><Btn tone="secondary" onClick={onClose}>Cancel</Btn><Btn disabled={busy || !list.length} onClick={async () => {
          setBusy(true);
          try {
            await save({ data: { id: row.id, name: row.rawName, service_postcodes: list, service_regions: regions.split(",").map((r) => r.trim()).filter(Boolean), verify_coverage: true } });
            toast.success("Coverage saved and verified");
            await qc.invalidateQueries({ queryKey: ["partners-board"] });
            await qc.invalidateQueries({ queryKey: ["business-file", row.id] });
            onClose();
          } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't save"); } finally { setBusy(false); }
        }}>{busy ? "Saving…" : "Save coverage"}</Btn></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
