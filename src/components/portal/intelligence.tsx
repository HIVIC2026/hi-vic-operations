import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAction } from "@/hooks/use-me";
import { Section } from "./panels";
import { Pill } from "./badges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fmtDateTime } from "@/lib/workflow";
import { addEscConfig, approveEscConfig, getInstallReadiness, recordEscSubmissionFn, recordPiesaDelivery, regenerateEscNotificationFn } from "@/lib/portal.functions";

// The second ESC notice panel was removed 24 Oct 2026 (audit removal 10); OfficePrestartCard is the one ESC panel.
export function EscConfigSection() {
  const add = useAction(addEscConfig); const approve = useAction(approveEscConfig);
  const { data = [] } = useQuery({ queryKey: ["esc_config"], queryFn: async () => (await supabase.from("esc_notification_config").select("*").order("created_at", { ascending: false })).data ?? [] });
  const [version, setVersion] = useState(""); const [src, setSrc] = useState(""); const [fields, setFields] = useState("");
  const parsed = fields.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [key, ...rest] = l.split("|"); return { key: (key ?? "").trim(), label: rest.join("|").trim() }; });
  return (
    <section className="space-y-2 rounded-xl border bg-card p-4">
      <h2 className="font-semibold">ESC notification fields (Ceiling Insulation Activity Guide)</h2>
      <p className="text-xs text-muted-foreground">Base fields (installation days, premises address, owner contact) are always sent. List any additional fields the current Activity Guide requires. Until a version is approved, every notice is "configuration required" and installation is blocked.</p>
      {data.length === 0 && <p className="text-sm text-danger">Not configured</p>}
      <ul className="space-y-1 text-sm">{data.map((c) => <li key={c.id} className="flex items-center gap-2 rounded border p-2"><b>{c.version}</b>{c.is_active ? <Pill t="good">Active</Pill> : c.approved ? <Pill>Superseded</Pill> : <Pill t="warn">Draft</Pill>}<span className="truncate text-xs text-muted-foreground">{(c.required_fields as { label: string }[]).map((f) => f.label).join(", ") || "no additional fields"}</span>{!c.approved && <Button size="sm" className="ml-auto" onClick={() => approve({ id: c.id }, "Approved")}>Approve & activate</Button>}</li>)}</ul>
      <Input placeholder="Version" value={version} onChange={(e) => setVersion(e.target.value)} />
      <Input placeholder="Source (Activity Guide name / date / URL)" value={src} onChange={(e) => setSrc(e.target.value)} />
      <Textarea rows={4} placeholder={"One per line: field_key|Label"} value={fields} onChange={(e) => setFields(e.target.value)} />
      <Button size="sm" disabled={!version.trim() || src.trim().length < 5} onClick={async () => { await add({ version, fields: parsed, source_note: src }, "Draft saved"); setVersion(""); setSrc(""); setFields(""); }}>Save draft</Button>
    </section>
  );
}
