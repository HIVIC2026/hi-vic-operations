import { Check } from "lucide-react";
import { OneTapAction } from "@/components/trade/one-tap-action";

/** The "install is finished" tap, shared by the Job page and Today's job. */
export function InstallFinishedButton({ run }: { run: () => Promise<unknown> }) {
  return <OneTapAction label={<><Check /> The install is finished</>} busyLabel="Recording…" confirm="Confirm the install is finished on site? Only do this once the Mitti install form is Complete." confirmLabel="Yes, it's finished" run={run} />;
}
