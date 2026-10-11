// Accessible in-page reason collection dialog replacing native window.prompt().
// Permissions, reason validation, audit strings and business behaviour are preserved
// by the call sites; this component only collects the reason text.
import { useCallback, useRef, useState } from "react";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type ReasonAskOptions = {
  title: string;
  description?: string;
  placeholder?: string;
  /** Trimmed length required before Confirm enables. Default 1. */
  minLength?: number;
  /** When set, the value must exactly equal this string (e.g. "APPROVE"). */
  requireExact?: string;
  confirmLabel?: string;
};

export function useReasonDialog() {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ReasonAskOptions | null>(null);
  const [value, setValue] = useState("");
  const resolver = useRef<((v: string | null) => void) | null>(null);

  const ask = useCallback((o: ReasonAskOptions) => {
    setOpts(o);
    setValue("");
    setOpen(true);
    return new Promise<string | null>((resolve) => { resolver.current = resolve; });
  }, []);

  const close = useCallback((result: string | null) => {
    setOpen(false);
    const r = resolver.current;
    resolver.current = null;
    r?.(result);
  }, []);

  const minLength = opts?.minLength ?? 1;
  const effective = opts?.requireExact ? value === opts.requireExact : value.trim().length >= minLength;

  const dialog = opts ? (
    <AlertDialog open={open} onOpenChange={(v) => { if (!v) close(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{opts.title}</AlertDialogTitle>
          {opts.description && <AlertDialogDescription>{opts.description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <div className="py-2">
          <Label htmlFor="reason-dialog-input" className="sr-only">{opts.title}</Label>
          <Input
            id="reason-dialog-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={opts.placeholder}
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter" && effective) { e.preventDefault(); close(opts.requireExact ? value : value.trim()); } }}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(null)}>Cancel</AlertDialogCancel>
          <Button disabled={!effective} onClick={() => close(opts.requireExact ? value : value.trim())}>{opts.confirmLabel ?? "Confirm"}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ) : null;

  return { ask, dialog };
}
