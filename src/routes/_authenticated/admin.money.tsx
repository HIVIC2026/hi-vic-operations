// O6 Money (approved, decisions 230/240/243): Overview · Payouts · Invoices · VEECs · Prices. Office only.
// Every element carries data-why (decision 241). No "Record payment" anywhere (decision 240): payments come from
// Stripe or Xero reconciliation; overdue invoices offer "Chase ›" (log a call or note). The VEEC spot price is
// entered in ONE place: the VEECs tab.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, Fragment } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/portal/AppShell";
import { Btn, PageHeader, Pill, StatTile, fieldInput } from "@/components/portal/kit";
import { OfficeTabs, OfficeTable, Loading, LoadError, TabCaption, dollars, fmtDay, type OfficeTabDef } from "@/components/portal/office-tabs";
import { LogCallDialog } from "@/components/portal/office-actions";
import { useReasonDialog } from "@/components/portal/reason-dialog";
import { useAction } from "@/hooks/use-me";
import { approveElectricianForm, markPayoutPaid } from "@/lib/office.functions";
import { getMoneyInvoices, getMoneyMargins, getMoneyPayouts, getMoneyVeecs, saveVeecSpotPrice } from "@/lib/office-money.functions";
import { getOwnerPrices, setOwnerPrices } from "@/lib/owner-prices.functions";
import { INSTALL_DEPOSIT_RATE } from "@/lib/payments.core";

type Tab = "overview" | "payouts" | "invoices" | "veecs" | "prices";
const TAB_KEYS: Tab[] = ["overview", "payouts", "invoices", "veecs", "prices"];

export const Route = createFileRoute("/_authenticated/admin/money")({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } => (TAB_KEYS.includes(s["tab"] as Tab) && s["tab"] !== "overview" ? { tab: s["tab"] as Tab } : {}),
  head: () => ({ meta: [{ title: "Money – Home Insulation Victoria" }, { name: "description", content: "What we earn and owe: margin, payouts, invoices, VEECs and prices." }, { name: "robots", content: "noindex, nofollow" }] }),
  component: Money,
});

function Money() {
  const { tab = "overview" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const loadPay = useServerFn(getMoneyPayouts);
  const loadInv = useServerFn(getMoneyInvoices);
  const loadVeec = useServerFn(getMoneyVeecs);
  const payouts = useQuery({ queryKey: ["money-payouts"], queryFn: () => loadPay(), staleTime: 30_000 });
  const invoices = useQuery({ queryKey: ["money-invoices"], queryFn: () => loadInv(), staleTime: 30_000 });
  const veecs = useQuery({ queryKey: ["money-veecs"], queryFn: () => loadVeec(), staleTime: 30_000 });
  const tabs: OfficeTabDef<Tab>[] = [
    { key: "overview", label: "Overview", count: new Date().toLocaleDateString("en-AU", { month: "short", timeZone: "Australia/Melbourne" }), why: "audit §6 Overview; decision 230 margin per job" },
    { key: "payouts", label: "Payouts", count: payouts.data?.due.length ?? null, why: "decisions 30/109 Mark paid" },
    { key: "invoices", label: "Invoices", count: invoices.data?.openCount ?? null, why: "decisions 139–144; 240 Stripe/Xero only" },
    { key: "veecs", label: "VEECs", count: veecs.data?.lodgedMonth.jobs ?? null, why: "audit §6: spot price entered here only; lodgement record" },
    { key: "prices", label: "Prices", why: "decisions 26/139/140/141/142 owner prices and fixed rules" },
  ];
  return (
    <AppShell wide>
      <PageHeader title="Money" sub="What we earn and owe." />
      <OfficeTabs label="Money" tabs={tabs} value={tab} onChange={(t) => void navigate({ search: t === "overview" ? {} : { tab: t } })} />
      {tab === "overview" && <Overview payouts={payouts} invoices={invoices} veecs={veecs} />}
      {tab === "payouts" && <Payouts q={payouts} />}
      {tab === "invoices" && <Invoices q={invoices} />}
      {tab === "veecs" && <Veecs q={veecs} />}
      {tab === "prices" && <Prices />}
    </AppShell>
  );
}

type Q<T> = { data: T | undefined; error: unknown; isPending: boolean; refetch: () => unknown };
type PayoutsData = Awaited<ReturnType<typeof getMoneyPayouts>>;
type InvoicesData = Awaited<ReturnType<typeof getMoneyInvoices>>;
type VeecsData = Awaited<ReturnType<typeof getMoneyVeecs>>;

function Overview({ payouts, invoices, veecs }: { payouts: Q<PayoutsData>; invoices: Q<InvoicesData>; veecs: Q<VeecsData> }) {
  const load = useServerFn(getMoneyMargins);
  const m = useQuery({ queryKey: ["money-margins"], queryFn: () => load(), staleTime: 30_000 });
  const [open, setOpen] = useState<string | null>(null);
  const month = new Date().toLocaleDateString("en-AU", { month: "long", year: "numeric", timeZone: "Australia/Melbourne" });
  const nextDue = payouts.data?.due[0]?.dueAt;
  return (
    <section data-why="audit §6 Overview (margin, VEECs lodged, owners owe, we owe trades); decision 230">
      <TabCaption>{month} · what we earn and owe · office only</TabCaption>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div data-why="VEECs lodged this month (decisions 28–29)"><StatTile label={`VEECs lodged · ${month.split(" ")[0]}`} value={veecs.data ? `${veecs.data.lodgedMonth.jobs} jobs · ${veecs.data.lodgedMonth.veecs}` : "…"} sub={veecs.data ? `${dollars(veecs.data.lodgedMonth.value)} at the price on the day` : undefined} /></div>
        <div data-why="decisions 139–144: one Xero invoice per job"><StatTile label="Owners owe" value={invoices.data ? dollars(invoices.data.owedCents / 100) : "…"} sub={invoices.data ? `${invoices.data.openCount} invoices · ${invoices.data.overdue} overdue` : undefined} /></div>
        <div data-why="decisions 30/109 payouts"><StatTile label="We owe trades" value={payouts.data ? dollars(payouts.data.owedEx) : "…"} sub={payouts.data ? (payouts.data.due.length ? `ex GST · next due ${fmtDay(nextDue)}${payouts.data.unknownAmounts ? ` · ${payouts.data.unknownAmounts} amount unknown` : ""}${payouts.data.held.length ? ` · ${payouts.data.held.length} held` : ""}` : payouts.data.held.length ? `nothing payable · ${payouts.data.held.length} held` : "nothing due") : undefined} /></div>
        <div data-why="decision 230 monthly margin total"><StatTile label={`Margin · ${month.split(" ")[0]}`} value={m.data ? dollars(m.data.month.total) : "…"} sub={m.data ? `${m.data.month.jobs} jobs complete${m.data.month.pct != null ? ` · ${m.data.month.pct}% average` : ""}${m.data.month.unknown ? ` · ${m.data.month.unknown} not worked out` : ""}` : undefined} /></div>
      </div>
      {m.error ? <LoadError what="Margins" error={m.error} retry={() => void m.refetch()} /> : m.isPending ? <Loading what="margins" /> : (
        <OfficeTable why="decision 230 per-job margin column (one pure rule: job-margin.core)" isEmpty={!m.data!.rows.length} empty="No accepted quotes yet."
          head={["Job", "Owner", "Price", "Installer pay", "Electrician", "VEEC net", "Margin", "%"]}>
          {m.data!.rows.map((r) => (
            <Fragment key={r.jobId}>
              <tr className="cursor-pointer hover:bg-mist/40" onClick={() => setOpen(open === r.jobId ? null : r.jobId)} aria-expanded={open === r.jobId}>
                <td><Link to="/admin/jobs/$jobId" params={{ jobId: r.jobId }} className="font-semibold text-hiv-blue hover:underline" onClick={(e) => e.stopPropagation()}>{r.jobNumber}</Link><span className="block text-xs text-sub">{r.status}</span></td>
                <td>{r.owner ?? "—"}</td>
                <td>{dollars(r.priceInc)}</td>
                <td>{r.installerPay == null ? "—" : dollars(-r.installerPay)}</td>
                <td>{r.electrician == null ? "—" : dollars(-r.electrician)}</td>
                <td>{dollars(r.veecNet, true)}</td>
                <td className="font-semibold">{r.margin == null ? <span className="text-sub">not yet</span> : dollars(r.margin)}</td>
                <td>{r.pct == null ? "—" : `${r.pct}%`}</td>
              </tr>
              {open === r.jobId && <tr className="bg-mist/40"><td colSpan={8}>
                <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">{r.lines.map((l) => <div key={l.key} className="flex justify-between gap-3"><dt className="text-sub">{l.label}</dt><dd className="font-semibold text-ink">{dollars(l.amount, true)}</dd></div>)}</dl>
                {r.missing.length > 0 && <p className="mt-2 text-xs text-rose">Not worked out: {r.missing.join(" · ")}.</p>}
              </td></tr>}
            </Fragment>
          ))}
        </OfficeTable>
      )}
      <p className="mt-3 text-xs text-sub" data-why="decision 230 definition">Price is before the VEEC incentive and includes GST; VEEC net = value received − incentive given; margin after GST, installer, electrician and fixes cost (the $100 on fixes with our electrician stays ours; none on an installer's own electrician). Click a row for the breakdown. Office only — never shown to trades or owners.</p>
    </section>
  );
}

function Payouts({ q }: { q: Q<PayoutsData> }) {
  const mark = useServerFn(markPayoutPaid);
  const approve = useServerFn(approveElectricianForm);
  const qc = useQueryClient();
  const reason = useReasonDialog();
  const [busy, setBusy] = useState<string | null>(null);
  if (q.error) return <LoadError what="Payouts" error={q.error} retry={() => void q.refetch()} />;
  if (q.isPending || !q.data) return <Loading what="payouts" />;
  const markGroup = async (g: PayoutsData["due"][number]) => {
    const ref = await reason.ask({ title: `Mark ${g.business} paid?`, description: `${g.jobs.map((j) => j.jobNumber).join(" · ")}${g.amountEx != null ? ` · ${dollars(g.amountEx)} ex GST` : ""}. Enter the bank transfer reference. No money moves from here.`, placeholder: "Bank reference", minLength: 2, confirmLabel: "Mark paid" });
    if (!ref) return;
    setBusy(g.key);
    try {
      for (const j of g.jobs) await mark({ data: { jobId: j.jobId, reference: ref.trim(), kind: j.kind } });
      toast.success(`${g.business} marked paid`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't mark paid"); }
    finally { setBusy(null); await qc.invalidateQueries({ queryKey: ["money-payouts"] }); }
  };
  // Decision 410: someone in the office approves the electrician's completed Mitti form; pay is due 7 days later.
  const approveForm = async (h: PayoutsData["held"][number]) => {
    if (h.kind === "installation") return;
    const key = `approve:${h.jobId}:${h.kind}`;
    setBusy(key);
    try {
      await approve({ data: { jobId: h.jobId, kind: h.kind } });
      toast.success(`${h.jobNumber} form approved · ${h.business} paid within 7 days`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't approve the form"); }
    finally { setBusy(null); await qc.invalidateQueries({ queryKey: ["money-payouts"] }); }
  };
  const forText = (g: PayoutsData["due"][number]) => g.trade === "installer" ? `${g.jobs.length} install${g.jobs.length === 1 ? "" : "s"} complete · installer pay` : `${g.jobs.filter((j) => j.kind === "assessment").length} PIESAs · ${g.jobs.filter((j) => j.kind === "rectification").length} fixes at cost`;
  return (
    <section data-why="decisions 30/109 Mark paid">
      <TabCaption>What we owe installers and electricians · due within 7 days of Final check · paid by bank transfer · Mark paid records the bank reference · Held = the Mitti form isn't Complete or a geotagged photo/video is missing (decision 318: no complete form, no payment) · electricians: press Approve on their completed form, pay is due 7 days later (decision 410; never waits for the owner)</TabCaption>
      <OfficeTable why="decisions 30/109" isEmpty={!q.data.due.length && !q.data.held.length && !q.data.paid.length} empty="No payouts yet." head={["Business", "Jobs", "For", "Amount", "Due", ""]}>
        {q.data.due.map((g) => (
          <tr key={g.key}>
            <td className="font-semibold">{g.business}</td>
            <td className="text-xs">{g.jobs.map((j) => j.jobNumber).filter((v, i, a) => a.indexOf(v) === i).join(" · ")}</td>
            <td className="text-xs text-sub">{forText(g)}</td>
            <td className="font-semibold">{g.amountEx == null ? "to confirm" : `${dollars(g.amountEx)} ex GST`}</td>
            <td>{fmtDay(g.dueAt)}</td>
            <td data-why="decisions 30/109: office records each payout; no money moves automatically"><Btn tone="secondary" disabled={busy === g.key} onClick={() => void markGroup(g)}>{busy === g.key ? "Saving…" : "Mark paid"}</Btn></td>
          </tr>
        ))}
        {q.data.held.map((h) => (
          <tr key={`held:${h.jobId}:${h.kind}`} data-payout-held data-why="decision 318: no complete Mitti form, no payment">
            <td className="font-semibold">{h.business}</td>
            <td className="text-xs">{h.jobNumber}</td>
            <td className="text-xs text-sub">{h.kind === "installation" ? "Install · installer pay" : h.kind === "assessment" ? "PIESA" : "Fixes at cost"}<span className="mt-1 block text-rose">{h.reasons.map((r) => <span key={r} className="block">{r}</span>)}</span></td>
            <td className="font-semibold">{h.amountEx == null ? "to confirm" : `${dollars(h.amountEx)} ex GST`}</td>
            <td>{fmtDay(h.dueAt)}</td>
            <td>{h.approvable && h.kind !== "installation"
              ? <Btn tone="secondary" data-approve-electrician-form disabled={busy === `approve:${h.jobId}:${h.kind}`} onClick={() => void approveForm(h)}>{busy === `approve:${h.jobId}:${h.kind}` ? "Saving…" : "Approve form"}</Btn>
              : <Pill tone="rose">Held</Pill>}</td>
          </tr>
        ))}
        {q.data.paid.map((g) => (
          <tr key={g.key} className="text-sub">
            <td>{g.business}</td><td className="text-xs">{g.jobs.map((j) => j.jobNumber).join(" · ")}</td><td className="text-xs">Paid {fmtDay(g.paidAt)} · bank transfer</td>
            <td>{g.amountEx == null ? "—" : dollars(g.amountEx)}</td><td>{fmtDay(g.paidAt)}</td><td><Pill tone="green">Paid</Pill></td>
          </tr>
        ))}
      </OfficeTable>
      {reason.dialog}
    </section>
  );
}

function Invoices({ q }: { q: Q<InvoicesData> }) {
  const [chase, setChase] = useState<{ jobId: string; jobNumber: string; state: string } | null>(null);
  if (q.error) return <LoadError what="Invoices" error={q.error} retry={() => void q.refetch()} />;
  if (q.isPending || !q.data) return <Loading what="invoices" />;
  return (
    <section data-why="decisions 139–144, 209; 240 Stripe/Xero only">
      <TabCaption>One Xero invoice per job · paid from Stripe or Xero reconciliation · steps are paid when the running total reaches each amount · Chase opens Log a call or note</TabCaption>
      <OfficeTable why="decision 240: no Record payment; payments read from Xero/Stripe" isEmpty={!q.data.rows.length} empty="No invoices yet." head={["Invoice", "Owner", "Job", "Total", "Steps", "Paid", "State"]}>
        {q.data.rows.map((r) => (
          <tr key={r.invoiceId}>
            <td className="font-semibold">{r.invoiceNumber ?? "Not in Xero yet"}</td>
            <td>{r.owner ?? "—"}</td>
            <td><Link to="/admin/jobs/$jobId" params={{ jobId: r.jobId }} className="text-hiv-blue hover:underline">{r.jobNumber}</Link><span className="block text-xs text-sub">{r.stage}</span></td>
            <td>{dollars(r.totalCents / 100)}</td>
            <td className="text-xs">{r.steps}</td>
            <td>{dollars(r.paidCents / 100)}</td>
            <td><span className="flex flex-wrap items-center gap-2"><Pill tone={r.tone}>{r.state}</Pill>{r.chase && <button type="button" data-why="decision 240: overdue rows → log a call or note" className="text-sm font-semibold text-hiv-blue hover:underline" onClick={() => setChase({ jobId: r.jobId, jobNumber: r.jobNumber, state: r.state })}>Chase ›</button>}</span></td>
          </tr>
        ))}
      </OfficeTable>
      {q.data.bounded && <p className="mt-2 text-xs text-sub">Showing the latest 80 open and 20 paid invoices.</p>}
      {chase && <LogCallDialog jobId={chase.jobId} jobNumber={chase.jobNumber} context={`Chasing payment (${chase.state})`} onClose={() => setChase(null)} />}
    </section>
  );
}

function Veecs({ q }: { q: Q<VeecsData> }) {
  const save = useAction(saveVeecSpotPrice);
  const [price, setPrice] = useState("");
  useEffect(() => { if (q.data?.spot.price != null) setPrice(String(q.data.spot.price)); }, [q.data?.spot.price]);
  if (q.error) return <LoadError what="VEECs" error={q.error} retry={() => void q.refetch()} />;
  if (q.isPending || !q.data) return <Loading what="VEECs" />;
  const d = q.data;
  const n = Number(price);
  return (
    <section data-why="audit §6 spot price entered here only; lodgement record">
      <TabCaption>Lodgements, value and the spot price</TabCaption>
      <div className="mb-5 grid gap-3 lg:grid-cols-4">
        <div data-why="audit §6: one place for the VEEC price" className="rounded-[14px] border border-line bg-paper p-4">
          <label htmlFor="spot" className="block text-xs text-sub">VEEC spot price · the one place it is entered</label>
          <div className="mt-1 flex gap-2"><span className="self-center font-display text-xl font-bold">$</span><input id="spot" inputMode="decimal" className={fieldInput} value={price} onChange={(e) => setPrice(e.target.value)} />
            <Btn disabled={!(n > 0) || n === d.spot.price} onClick={async () => { if (await save({ price: n }, "Spot price saved")) await q.refetch(); }}>Save</Btn></div>
          <p className="mt-1.5 text-[11px] text-sub">{d.spot.pricedOn ? `Last set ${fmtDay(d.spot.pricedOn)}` : "Not set yet"}{d.spot.previous != null ? ` · $${d.spot.previous} before` : ""}</p>
        </div>
        <StatTile label={`Lodged · ${new Date().toLocaleDateString("en-AU", { month: "long", timeZone: "Australia/Melbourne" })}`} value={`${d.lodgedMonth.jobs} jobs · ${d.lodgedMonth.veecs} VEECs`} sub={`${dollars(d.lodgedMonth.value)} at the price on the day`} />
        <StatTile label="Registered" value={`${d.registered.jobs} jobs · ${d.registered.veecs} VEECs`} sub={`${dollars(d.registered.received)} received`} />
        <StatTile label="Waiting" value={`${d.waiting.jobs} jobs · ${d.waiting.veecs} VEECs`} sub="registry pending" />
      </div>
      <OfficeTable why="decisions 28–29, 119: per-job lodged / registered" isEmpty={!d.rows.length} empty="No installs complete yet." head={["Job", "Owner", "Install", "VEECs", "Claimed", "Received", "Registry"]}>
        {d.rows.map((r) => (
          <tr key={r.jobId}>
            <td><Link to="/admin/jobs/$jobId" params={{ jobId: r.jobId }} className="font-semibold text-hiv-blue hover:underline">{r.jobNumber}</Link></td>
            <td>{r.owner ?? "—"}</td>
            <td className="text-xs">{fmtDay(r.installedAt)}{r.areaM2 != null ? ` · ${Math.round(r.areaM2)} m²` : ""}</td>
            <td>{r.veecs ?? "—"}</td><td>{dollars(r.claimed)}</td><td>{dollars(r.received)}</td>
            <td className="text-xs">{r.registry}</td>
          </tr>
        ))}
      </OfficeTable>
    </section>
  );
}

const PRICE_FIELDS: { key: "r5" | "removal" | "piesa" | "moderate" | "difficult"; label: string }[] = [
  { key: "r5", label: "R5.0 batts per m² (inc GST)" }, { key: "removal", label: "Removal per m² (inc GST)" }, { key: "piesa", label: "Safety check (PIESA) payment" },
  { key: "moderate", label: "Moderate access multiplier" }, { key: "difficult", label: "Difficult access multiplier" },
];

function Prices() {
  const load = useServerFn(getOwnerPrices);
  const save = useAction(setOwnerPrices);
  const q = useQuery({ queryKey: ["owner-prices"], queryFn: () => load() });
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState<Record<string, string>>({});
  const [reasonText, setReasonText] = useState("");
  const c = q.data?.current;
  useEffect(() => { if (c) setF({ r5: String(c.r5), removal: String(c.removal), piesa: String(c.piesa), moderate: String(c.moderate), difficult: String(c.difficult), apFee: String(c.apFee) }); }, [c]);
  if (q.error) return <LoadError what="Prices" error={q.error} retry={() => void q.refetch()} />;
  if (q.isPending) return <Loading what="prices" />;
  if (!c) return <p className="text-sm text-sub">No owner price list is set up.</p>;
  const lastChange = q.data?.history.find((h) => h.event_type === "owner_prices_changed");
  return (
    <section data-why="decisions 139/140/141/142/107 owner prices and fixed rules">
      <TabCaption>Owner prices and the fixed payment rules</TabCaption>
      <OfficeTable why="decisions 26, 139–142" head={["Setting", "What it says", "Effective", ""]}>
        <tr data-why="decision 26: our fixed owner price list">
          <td className="font-semibold">Owner price list</td>
          <td>R5.0 batts ${c.r5}/m² · removal ${c.removal}/m² · access ×{c.moderate} moderate, ×{c.difficult} difficult · all inc GST, before the VEEC incentive</td>
          <td className="text-xs">v{c.version}{lastChange ? ` · ${fmtDay(lastChange.created_at)}` : ""}</td>
          <td><Btn tone="secondary" onClick={() => setEdit((e) => !e)}>{edit ? "Close" : "Edit"}</Btn></td>
        </tr>
        <tr data-why="decisions 139/140: $349 at acceptance, card or bank"><td className="font-semibold">PIESA fee</td><td>${c.piesa} inc GST after acceptance · unlocks the PIESA booking only · card or bank transfer · no card fee is ever shown</td><td className="text-xs">24 Oct 2026</td><td><Pill>Fixed rule</Pill></td></tr>
        <tr data-why="Jo 26 Oct: 10% deposit paid before the install is booked"><td className="font-semibold">Install deposit</td><td>{Math.round(INSTALL_DEPOSIT_RATE * 100)}% of the install price (not the PIESA fee or fixes) · bank transfer / PayID · paid before the install is booked · balance on install day</td><td className="text-xs">26 Oct 2026</td><td><Pill>Fixed rule</Pill></td></tr>
        <tr data-why="decision 142: electrician price + $100 inc GST"><td className="font-semibold">Electrical fixes</td><td>Electrician's price + $100 inc GST spread across lines · paid in full at approval</td><td className="text-xs">24 Oct 2026</td><td><Pill>Fixed rule</Pill></td></tr>
        <tr data-why="decision 107/AP fee: owner only may change"><td className="font-semibold">AP fee on installer jobs</td><td>${c.apFee} · the installer's own price is never marked up</td><td className="text-xs">v{c.version}</td><td>{q.data?.canChangeApFee ? <Btn tone="secondary" onClick={() => setEdit(true)}>Edit</Btn> : <Pill>Jo only</Pill>}</td></tr>
        <tr data-why="decision 157: electrician rate card lives under Partners › Rates"><td className="font-semibold">Electrician rates</td><td>PIESA and fixes by item · per approved REC</td><td /><td><Link to="/admin/partners" search={{ tab: "rates" }} className="text-sm font-semibold text-hiv-blue hover:underline">Partners › Rates ›</Link></td></tr>
      </OfficeTable>
      {edit && (
        <div className="mt-4 rounded-[18px] border border-line bg-paper p-5" data-why="decision 26: price change publishes a new version for NEW quotes only">
          <p className="mb-3 text-sm text-sub">Saving publishes a new price version. It applies to new quotes only — issued and accepted quotes keep their prices.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {[...PRICE_FIELDS, ...(q.data?.canChangeApFee ? [{ key: "apFee" as const, label: "AP fee on installer jobs" }] : [])].map((p) => (
              <label key={p.key} className="text-xs font-semibold text-ink">{p.label}<input inputMode="decimal" className={`${fieldInput} mt-1`} value={f[p.key] ?? ""} onChange={(e) => setF({ ...f, [p.key]: e.target.value })} /></label>
            ))}
          </div>
          <label className="mt-3 block text-xs font-semibold text-ink">Reason for the change (required)<input className={`${fieldInput} mt-1`} value={reasonText} onChange={(e) => setReasonText(e.target.value)} placeholder="e.g. new installer rates agreed" /></label>
          <Btn className="mt-3" disabled={reasonText.trim().length < 3} onClick={async () => {
            const num = (k: string) => (f[k] !== undefined && f[k] !== "" && Number.isFinite(Number(f[k])) ? Number(f[k]) : undefined);
            const r = await save({ r5: num("r5"), removal: num("removal"), piesa: num("piesa"), moderate: num("moderate"), difficult: num("difficult"), ...(q.data?.canChangeApFee ? { apFee: num("apFee") } : {}), reason: reasonText.trim() }, "New price version published");
            if (r) { setEdit(false); setReasonText(""); await q.refetch(); }
          }}>Publish new prices</Btn>
        </div>
      )}
    </section>
  );
}
