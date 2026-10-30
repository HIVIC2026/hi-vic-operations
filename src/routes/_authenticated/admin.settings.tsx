// O7 Settings (approved, decisions 248/249): Templates · Switches · Automatic rules · Mitti forms · ESC fields · Xero ·
// Users & access · Deleted · Test Centre. "Wording, forms, connections and switches." Every element carries data-why
// (decision 241). Switch writes: only the office-editable columns and per-type text switches, compare-and-swap + audit
// (office-settings.server); code switches are read-only. Xero is read-only through the explicit connector, fail-closed.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/portal/AppShell";
import { Btn, PageHeader, Pill } from "@/components/portal/kit";
import { OfficeTabs, OfficeTable, Loading, LoadError, TabCaption, fmtDay, fmtWhen, type OfficeTabDef } from "@/components/portal/office-tabs";
import { ComplianceVersions } from "@/components/portal/compliance-versions";
import { OwnerDocuments } from "@/components/portal/owner-documents";
import { MittiFormsSection } from "@/components/portal/mitti-forms";
import { MeasurementStandardCard } from "@/components/portal/business";
import { EscConfigSection } from "@/components/portal/intelligence";
import { RepeatPiesaPriceCard } from "@/components/portal/repeat-piesa";
import { XeroConnectionCard } from "@/components/portal/xero-connection-card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-me";
import { getMessageRegister, getOfficeSwitches, getXeroPaymentsHealth, setOfficeSwitch } from "@/lib/office-settings.functions";
import { cancelHeldMessages, getHeldAndQueued } from "@/lib/office-comms.functions";
import { AUTOMATIC_RULES, SWITCHES, heldGroupsFor } from "@/lib/office-settings.core";
import { getAdminUsers } from "@/lib/admin-records.functions";
import { listDeletedJobs, restoreJob } from "@/lib/office.functions";

type Tab = "templates" | "switches" | "rules" | "mitti" | "esc" | "xero" | "users" | "deleted" | "test";
const TAB_KEYS: Tab[] = ["templates", "switches", "rules", "mitti", "esc", "xero", "users", "deleted", "test"];

export const Route = createFileRoute("/_authenticated/admin/settings")({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab; key?: string } => ({
    ...(TAB_KEYS.includes(s["tab"] as Tab) && s["tab"] !== "templates" ? { tab: s["tab"] as Tab } : {}),
    ...(typeof s["key"] === "string" ? { key: s["key"] } : {}),
  }),
  head: () => ({ meta: [{ title: "Settings – Home Insulation Victoria" }, { name: "description", content: "Wording, forms, connections and switches." }, { name: "robots", content: "noindex, nofollow" }] }),
  component: Settings,
});

const TABS: OfficeTabDef<Tab>[] = [
  { key: "templates", label: "Templates", why: "decisions 15/60 one wording register; 123/119 compliance versions" },
  { key: "switches", label: "Switches", why: "decisions 159, 16, 154, 246 automatic offers, AUTO_QUOTE_SEND_ENABLED" },
  { key: "rules", label: "Automatic rules", why: "decisions 220, 238, 2, 141, 120, 130, 158, 246" },
  { key: "mitti", label: "Mitti forms", why: "Mitti-first pickup rule; 205/206/210 form items" },
  { key: "esc", label: "ESC fields", why: "decisions 118b/121/195; Activity Guide Appendix A Table 5" },
  { key: "xero", label: "Xero", why: "decisions 176/179/181/182; fail-closed routing rule" },
  { key: "users", label: "Users & access", why: "decisions 159/177 TEST handover; access rule" },
  { key: "deleted", label: "Deleted", why: "audit Screen 27 deleted jobs; 227 real jobs are cancelled not deleted" },
  { key: "test", label: "Test Centre", why: "Test Centre rule (qa_test); 159/177/189 TEST run" },
];

function Settings() {
  const { tab = "templates", key } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AppShell wide>
      <PageHeader title="Settings" sub="Wording, forms, connections and switches." />
      <OfficeTabs label="Settings" tabs={TABS} value={tab} onChange={(t) => void navigate({ search: t === "templates" ? {} : { tab: t } })} />
      {tab === "templates" && <Templates initialKey={key} />}
      {tab === "switches" && <Switches />}
      {tab === "rules" && <section data-why="decisions 220, 238, 2, 141, 120, 130, 158, 246"><TabCaption>What the portal does on its own</TabCaption>
        <OfficeTable why="read-only list of automatic rules" head={["Rule", "What happens"]}>{AUTOMATIC_RULES.map((r) => <tr key={r.rule} data-why={r.why}><td className="font-semibold">{r.rule}</td><td>{r.what}</td></tr>)}</OfficeTable><RepeatPiesaPriceCard /></section>}
      {tab === "mitti" && <section className="space-y-5" data-why="Mitti-first pickup rule; 205/206/210 form items"><TabCaption>The Mitti forms the portal reads · forms started in Mitti become jobs every 15 minutes (switch under Switches); ones that can't be matched wait on Installer jobs › Mitti forms to sort out.</TabCaption><MittiFormsSection /><MeasurementStandardCard /></section>}
      {tab === "esc" && <section data-why="decisions 118b/121/195; Activity Guide Appendix A Table 5"><TabCaption>What goes in the VEU Registry install notification, and where each value comes from</TabCaption><EscConfigSection /></section>}
      {tab === "xero" && <XeroTab />}
      {tab === "users" && <UsersTab />}
      {tab === "deleted" && <DeletedTab />}
      {tab === "test" && <TestCentreTab />}
    </AppShell>
  );
}

function Templates({ initialKey }: { initialKey?: string | undefined }) {
  const load = useServerFn(getMessageRegister);
  const q = useQuery({ queryKey: ["message-register"], queryFn: () => load(), staleTime: 300_000 });
  return (
    <section className="space-y-6" data-why="decisions 15/60 one wording register; 123/119 compliance versions">
      <div>
        <TabCaption>Every email and text, who gets it and when · click a message to read it in the template register</TabCaption>
        {q.error ? <LoadError what="The register" error={q.error} retry={() => void q.refetch()} /> : !q.data ? <Loading what="the register" /> : (
          <OfficeTable why="decision 60 touchpoint list: who · when · auto or pressed" head={["Message", "Who · when", "How it goes", ""]}>
            {q.data.map((m, i) => (
              <tr key={i} data-why={m.why}>
                <td><Link to="/admin/templates" search={{ cat: "owner" }} className="font-semibold text-hiv-blue hover:underline">{m.message}</Link> <span className="text-xs text-sub">· {m.channel}</span></td>
                <td>{m.who}</td><td>{m.how}</td>
                <td>{m.approved ? <Pill tone="green">Approved</Pill> : <Pill tone="amber">Draft · for Jo</Pill>}</td>
              </tr>
            ))}
          </OfficeTable>
        )}
      </div>
      <div className="rounded-[18px] border border-line bg-paper p-5" data-why="decisions 118a/119/123: compliance form versions (Jo only)"><ComplianceVersions initialKey={initialKey} /></div>
      <div className="rounded-[18px] border border-line bg-paper p-5" data-why="owner documents by gate (merged from Owner paperwork)"><OwnerDocuments /></div>
    </section>
  );
}

type SwitchRow = Awaited<ReturnType<typeof getOfficeSwitches>>["switches"][number];

function Switches() {
  const load = useServerFn(getOfficeSwitches);
  const loadHeld = useServerFn(getHeldAndQueued);
  const q = useQuery({ queryKey: ["office-switches"], queryFn: () => load() });
  const held = useQuery({ queryKey: ["comms-held"], queryFn: () => loadHeld(), staleTime: 30_000 });
  const [flip, setFlip] = useState<SwitchRow | null>(null);
  const [more, setMore] = useState(false);
  if (q.error) return <LoadError what="Switches" error={q.error} retry={() => void q.refetch()} />;
  if (!q.data) return <Loading what="switches" />;
  const named = q.data.switches.slice(0, q.data.named);
  const types = q.data.switches.slice(q.data.named);
  const heldCount = held.data ? held.data.held : null;
  const row = (s: SwitchRow) => (
    <tr key={s.key} data-why={s.why}>
      <td className="font-semibold">{s.label}</td>
      <td className="text-xs">{s.what}{s.note && <span className="mt-0.5 block text-sub">{s.note}</span>}</td>
      <td>{s.on == null ? <Pill tone="rose">Couldn't read</Pill> : s.on ? <Pill tone="green">On</Pill> : <Pill>Off</Pill>}</td>
      <td>{s.editable && s.on != null && <Btn tone="secondary" onClick={() => setFlip(s)}>Turn {s.on ? "off" : "on"}</Btn>}</td>
    </tr>
  );
  return (
    <section data-why="decisions 159, 16, 154, 246 automatic offers, AUTO_QUOTE_SEND_ENABLED">
      <TabCaption>Nothing sends until its switch is on</TabCaption>
      <OfficeTable why="decision 159: one switch per type" head={["Switch", "What it controls", "", ""]}>{named.map(row)}</OfficeTable>
      <button type="button" className="mt-3 text-sm font-semibold text-hiv-blue hover:underline" onClick={() => setMore((m) => !m)}>{more ? "Hide" : "Show"} every text type ({types.length})</button>
      {more && <div className="mt-2"><OfficeTable why="decision 159: per-type text switches" head={["Text", "Who", "", ""]}>{types.map(row)}</OfficeTable></div>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-sub">Switch on one type at a time. Turning one on asks whether to cancel what is held for it first.</p>
        {heldCount != null && heldCount > 0 && <Link to="/admin/communications" className="text-sm font-semibold text-rose hover:underline" data-why="decision 16: cancel all held">Cancel all held · {heldCount} ›</Link>}
      </div>
      {flip && <FlipDialog s={flip} held={held.data} onClose={() => setFlip(null)} />}
    </section>
  );
}

function FlipDialog({ s, held, onClose }: { s: SwitchRow; held: Awaited<ReturnType<typeof getHeldAndQueued>> | undefined; onClose: () => void }) {
  const set = useServerFn(setOfficeSwitch);
  const cancel = useServerFn(cancelHeldMessages);
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [cancelFirst, setCancelFirst] = useState(true);
  const [busy, setBusy] = useState(false);
  const def = SWITCHES.find((d) => d.key === s.key) ?? (s.key.startsWith("sms:") ? { kind: "sms" as const, smsType: s.key.slice(4), key: s.key, label: s.label, what: s.what, why: s.why } : null);
  const turningOn = !s.on;
  const match = def ? heldGroupsFor(def) : () => false;
  const heldKeys = turningOn ? (held?.groups ?? []).filter((g) => g.state === "held" && match(g.id)).flatMap((g) => g.items.map((i) => i.key)) : [];
  const go = async () => {
    setBusy(true);
    try {
      if (heldKeys.length && cancelFirst) await cancel({ data: { keys: heldKeys, scope: `before switching on ${s.key}` } });
      await set({ data: { key: s.key, on: turningOn, expected: !!s.on, reason: reason.trim() } });
      toast.success(`${s.label} turned ${turningOn ? "on" : "off"}`);
      await qc.invalidateQueries({ queryKey: ["office-switches"] });
      await qc.invalidateQueries({ queryKey: ["comms-held"] });
      onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Switch not changed"); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Turn {turningOn ? "on" : "off"} · {s.label}</DialogTitle><DialogDescription>{s.what}. Recorded with your name and reason.</DialogDescription></DialogHeader>
        {heldKeys.length > 0 && <label className="flex items-start gap-2 rounded-[13px] bg-mist px-4 py-3 text-sm"><input type="checkbox" className="mt-1" checked={cancelFirst} onChange={(e) => setCancelFirst(e.target.checked)} /><span>Cancel the {heldKeys.length} held for it first. Held messages never send on their own; cancelling clears them from the held list.</span></label>}
        <Textarea aria-label="Reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (e.g. Jo approved switching this on)" />
        <DialogFooter><Btn tone="secondary" onClick={onClose}>Cancel</Btn><Btn disabled={busy || reason.trim().length < 3} onClick={() => void go()}>{busy ? "Saving…" : `Turn ${turningOn ? "on" : "off"}`}</Btn></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function XeroTab() {
  const load = useServerFn(getXeroPaymentsHealth);
  const q = useQuery({ queryKey: ["xero-payments-health"], queryFn: () => load() });
  return (
    <section className="space-y-4" data-why="decisions 176/179/181/182; fail-closed routing rule">
      <TabCaption>Which Xero organisation the portal uses · TEST jobs only ever reach the Demo Company</TabCaption>
      <XeroConnectionCard />
      <div className="rounded-[18px] border border-line bg-paper p-5 text-sm" data-why="decision 139: payments read from Xero (webhook + 15-minute poll)">
        <h3 className="mb-2 font-display text-base font-semibold text-ink">Payments</h3>
        {q.error ? <LoadError what="Payments health" error={q.error} /> : !q.data ? <Loading what="payments health" /> : (
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
            <dt className="text-sub">Xero webhook</dt><dd>{q.data.webhookConfigured ? "On (signing key set)" : "Off — XERO_WEBHOOK_KEY not set"}</dd>
            <dt className="text-sub">15-minute check</dt><dd>{q.data.pollEnabled ? "On" : "Off — XERO_PAYMENT_POLL_ENABLED not true"}</dd>
            <dt className="text-sub">Card payments (Stripe)</dt><dd>{q.data.stripeEnabled ? "On ($349 and fixes only)" : "Off"}</dd>
            <dt className="text-sub">Last payment seen</dt><dd>{q.data.lastPaymentAt ? fmtWhen(q.data.lastPaymentAt) : "None yet"}</dd>
          </dl>
        )}
        <p className="mt-3 text-xs text-sub">Switching or reconnecting the organisation is done in the Xero connector settings; the portal never falls back to another connection.</p>
      </div>
    </section>
  );
}

const ROLE_SEES: Record<string, string> = { admin: "Office portal · signs as AP representative", installer: "Installer portal", electrician: "Electrician portal" };

function UsersTab() {
  const load = useServerFn(getAdminUsers);
  const q = useQuery({ queryKey: ["users"], queryFn: () => load(), retry: 3, staleTime: 30_000 });
  if (q.error) return <LoadError what="Users" error={q.error} retry={() => void q.refetch()} />;
  if (!q.data) return <Loading what="users" />;
  const d = q.data;
  const rolesOf = (id: string) => d.roles.filter((r) => r.user_id === id).map((r) => r.role as string);
  const people = d.profiles.filter((p) => rolesOf(p.id).some((r) => r === "admin" || r === "installer" || r === "electrician")).slice(0, 80);
  return (
    <section data-why="decisions 159/177 TEST handover; access rule">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <TabCaption>Who can sign in</TabCaption>
        <div className="flex flex-wrap gap-3 text-sm font-semibold">
          <a href="/admin/users#test-login" className="text-hiv-blue hover:underline" data-why="AGENTS: TEST handover = exact QA preflight + private download">Prepare Deep's TEST login ›</a>
          <Link to="/admin/users" className="text-hiv-blue hover:underline" data-why="roles and Mitti access checks">Manage roles and Mitti checks ›</Link>
        </div>
      </div>
      <OfficeTable why="access rule" isEmpty={!people.length} empty="No staff or trade logins yet." head={["Person", "Role", "Sees and does"]}>
        {people.map((p) => { const rs = rolesOf(p.id); const biz = d.businesses.find((b) => b.id === p.business_id)?.name; return (
          <tr key={p.id}><td className="font-semibold">{p.full_name ?? p.email}<span className="block text-xs font-normal text-sub">{p.email}</span></td>
            <td>{rs.includes("admin") ? "Office" : `${rs.includes("electrician") ? "Electrician" : "Installer"}${biz ? ` · ${biz}` : ""}`}</td>
            <td className="text-xs">{rs.map((r) => ROLE_SEES[r]).filter(Boolean).join(" · ")}</td></tr>
        ); })}
      </OfficeTable>
    </section>
  );
}

function DeletedTab() {
  const load = useServerFn(listDeletedJobs);
  const restore = useAction(restoreJob);
  const q = useQuery({ queryKey: ["deleted-jobs"], queryFn: () => load() });
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  if (q.error) return <LoadError what="Deleted jobs" error={q.error} retry={() => void q.refetch()} />;
  if (!q.data) return <Loading what="deleted jobs" />;
  return (
    <section data-why="audit Screen 27 deleted jobs; 227 real jobs are cancelled not deleted">
      <TabCaption>Deleted jobs · hidden from every list; nothing can be sent for them; history kept</TabCaption>
      <OfficeTable why="restore with a reason" isEmpty={!q.data.length} empty="No deleted jobs." head={["Job", "Owner", "Why", "Deleted", ""]}>
        {q.data.map((r) => (
          <tr key={r.id}>
            <td><Link to="/admin/jobs/$jobId" params={{ jobId: r.id }} className="font-semibold text-hiv-blue hover:underline">{r.jobNumber}</Link></td>
            <td>{r.owner ?? "—"}</td><td className="text-xs">{r.reason}</td><td>{fmtDay(r.deletedAt)}</td>
            <td>{open !== r.id ? <Btn tone="secondary" onClick={() => { setOpen(r.id); setReason(""); }}>Restore ›</Btn> : (
              <form className="flex gap-1" onSubmit={async (e) => { e.preventDefault(); if (await restore({ jobId: r.id, reason }, `${r.jobNumber} restored`)) { setOpen(null); await q.refetch(); } }}>
                <input aria-label={`Reason for restoring ${r.jobNumber}`} className="h-9 rounded-md border px-2 text-sm" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                <Btn type="submit" disabled={reason.trim().length < 3}>Restore</Btn></form>)}</td>
          </tr>
        ))}
      </OfficeTable>
      <p className="mt-3 text-xs text-sub">Only test jobs and duplicates are deleted; real jobs are cancelled and keep their history.</p>
    </section>
  );
}

function TestCentreTab() {
  const cards: { title: string; what: string; to: string; label: string; why: string }[] = [
    { title: "Jo's phone run-through", what: "Installer flow end to end on the TEST account (Jo as a fake tradie)", to: "/admin/test-centre", label: "Start run-through ›", why: "decisions 189, 204" },
    { title: "Deep's TEST handover", what: "Exact QA preflight and a private login file", to: "/admin/users#test-login", label: "Prepare handover ›", why: "decision 177; AGENTS TEST handover rule" },
    { title: "TEST accounts and practice jobs", what: "Office, installer, electrician and owner test accounts; dummy journeys (source qa_test)", to: "/admin/test-centre", label: "Open Test Centre ›", why: "Test Centre rule (qa_test)" },
  ];
  return (
    <section data-why="Test Centre rule (qa_test); 159/177/189 TEST run">
      <TabCaption>Practice safely · TEST jobs start as practice jobs and never reach live automation</TabCaption>
      <div className="grid gap-3 md:grid-cols-3">
        {cards.map((c) => <div key={c.title} data-why={c.why} className="rounded-[18px] border border-line bg-paper p-5"><h3 className="font-display text-base font-semibold text-ink">{c.title}</h3><p className="mt-1 text-sm text-sub">{c.what}</p><a href={c.to} className="mt-3 inline-block text-sm font-semibold text-hiv-blue hover:underline">{c.label}</a></div>)}
        <div data-why="Portal QA rule: bun run portal-qa only; gaps NOT_RUN" className="rounded-[18px] border border-line bg-paper p-5"><h3 className="font-display text-base font-semibold text-ink">Portal QA</h3><p className="mt-1 text-sm text-sub">Runs from the command line only: <code>bun run portal-qa</code>. Checks it can't run are reported NOT_RUN, never PASS. Results are not stored in the portal.</p></div>
      </div>
    </section>
  );
}
