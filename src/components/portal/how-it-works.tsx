// Renders the shared "How we work together" content (partner-howitworks.ts) as coloured cards.
// Used by installer onboarding and the partner help page so wording lives in one place.
import {
  AP_WORKLOAD, APP_PITCH, ELECTRICIAN_FAQ, ELECTRICIAN_FLEXIBILITY, ELECTRICIAN_JOB_FLOW, ELECTRICIAN_PAY, ELECTRICIAN_SAME_DAY,
  LEAD_24H_RULE, OPTION_OWN_CUSTOMER, OPTION_OUR_LEAD,
  PARTNER_FAQ, PAYMENT_TERMS, PORTAL_ONLY_COMMS, WHY_349, type HowStep,
} from "@/lib/partner-howitworks";

const NAVY = "#22376B";
const MUTED = "#4A5578";
const BLUE = "#3C51C4";
const GREEN = "#07BF61";
const PINK = { bg: "oklch(0.93 0.06 345)", fg: "oklch(0.43 0.13 345)" };
const BLUEA = { bg: "oklch(0.92 0.055 250)", fg: "oklch(0.4 0.14 255)" };
const GREENA = { bg: "oklch(0.93 0.07 145)", fg: "oklch(0.38 0.1 150)" };
const YELLOW = { bg: "oklch(0.94 0.075 85)", fg: "oklch(0.42 0.1 70)" };

const h: React.CSSProperties = { fontFamily: "'Outfit', 'Figtree', system-ui, sans-serif", color: NAVY };

function OptionCard({ accent, title, tagline, steps, footer }: { accent: { bg: string; fg: string }; title: string; tagline: string; steps: HowStep[]; footer: string }) {
  return (
    <div style={{ borderRadius: 18, border: `1px solid ${accent.fg}33`, background: accent.bg, padding: 18 }}>
      <div style={{ ...h, fontSize: 17, fontWeight: 800, color: accent.fg }}>{title}</div>
      <div style={{ fontSize: 13.5, color: NAVY, margin: "4px 0 12px", fontWeight: 600 }}>{tagline}</div>
      <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
        {steps.map((s) => (
          <li key={s.n} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span style={{ flexShrink: 0, width: 24, height: 24, borderRadius: "50%", background: accent.fg, color: "#fff", fontSize: 13, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{s.n}</span>
            <span style={{ fontSize: 14, lineHeight: 1.5, color: NAVY }}><strong>{s.title}.</strong> {s.body}</span>
          </li>
        ))}
      </ol>
      <div style={{ fontSize: 13, color: MUTED, marginTop: 12, lineHeight: 1.5, borderTop: `1px solid ${accent.fg}22`, paddingTop: 10 }}>{footer}</div>
    </div>
  );
}

function Panel({ accent, title, children }: { accent: { bg: string; fg: string }; title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderRadius: 14, background: accent.bg, border: `1px solid ${accent.fg}33`, padding: "14px 16px", marginBottom: 12 }}>
      <div style={{ ...h, fontWeight: 800, fontSize: 15, color: accent.fg, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 14, lineHeight: 1.55, color: NAVY }}>{children}</div>
    </div>
  );
}

export function HowItWorks() {
  return (
    <div>
      <Panel accent={GREENA} title="Our app: get it right on the day">
        {APP_PITCH}
      </Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, marginBottom: 14 }}>
        <OptionCard accent={PINK} {...OPTION_OWN_CUSTOMER} />
        <OptionCard accent={BLUEA} {...OPTION_OUR_LEAD} />
      </div>
      <Panel accent={YELLOW} title={ELECTRICIAN_FLEXIBILITY.title}>
        <p style={{ margin: "0 0 8px" }}>{ELECTRICIAN_FLEXIBILITY.body}</p>
        <ul style={{ margin: "0 0 8px", paddingLeft: 20 }}>
          {ELECTRICIAN_FLEXIBILITY.options.map((o) => <li key={o}>{o}</li>)}
        </ul>
        <div style={{ fontSize: 13, color: MUTED }}>{ELECTRICIAN_FLEXIBILITY.pricing}</div>
      </Panel>
      <Panel accent={GREENA} title={PAYMENT_TERMS.title}>
        <ul style={{ margin: 0, paddingLeft: 20 }}>{PAYMENT_TERMS.points.map((p) => <li key={p}>{p}</li>)}</ul>
      </Panel>
      <Panel accent={BLUEA} title={PORTAL_ONLY_COMMS.title}>
        <ul style={{ margin: 0, paddingLeft: 20 }}>{PORTAL_ONLY_COMMS.points.map((p) => <li key={p}>{p}</li>)}</ul>
      </Panel>
      <Panel accent={PINK} title={LEAD_24H_RULE.title}>
        <ul style={{ margin: 0, paddingLeft: 20 }}>{LEAD_24H_RULE.points.map((p) => <li key={p}>{p}</li>)}</ul>
      </Panel>
      <Panel accent={YELLOW} title={AP_WORKLOAD.title}>
        <p style={{ margin: "0 0 8px" }}>{AP_WORKLOAD.intro}</p>
        <ul style={{ margin: 0, paddingLeft: 20, columns: 2, columnGap: 24 }}>{AP_WORKLOAD.items.map((p) => <li key={p} style={{ breakInside: "avoid" }}>{p}</li>)}</ul>
      </Panel>
      <div style={{ borderRadius: 14, background: `linear-gradient(135deg, ${GREEN}14, ${BLUE}14)`, border: `1px solid ${BLUE}33`, padding: "14px 16px", marginBottom: 12 }}>
        <div style={{ ...h, fontWeight: 800, fontSize: 15, color: BLUE, marginBottom: 6 }}>{WHY_349.title}</div>
        <div style={{ fontSize: 14, lineHeight: 1.55, color: NAVY }}>{WHY_349.body}</div>
      </div>
      <div style={{ ...h, fontWeight: 800, fontSize: 15, margin: "16px 0 8px" }}>Common questions</div>
      <div style={{ display: "grid", gap: 8 }}>
        {PARTNER_FAQ.map((f) => (
          <details key={f.q} style={{ border: "1px solid #E4E8F0", borderRadius: 12, padding: "10px 14px", background: "#fff" }}>
            <summary style={{ fontWeight: 700, fontSize: 14, color: NAVY, cursor: "pointer" }}>{f.q}</summary>
            <p style={{ fontSize: 14, lineHeight: 1.55, color: MUTED, margin: "8px 0 2px" }}>{f.a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}

/** Electrician-facing "How we work together" — job flow, same-day rule, pay, comms. */
export function HowItWorksElectrician() {
  return (
    <div>
      <Panel accent={GREENA} title="One app, every job">
        <p style={{ margin: 0 }}>{APP_PITCH}</p>
      </Panel>
      <StepsCard title={ELECTRICIAN_JOB_FLOW.title} tagline={ELECTRICIAN_JOB_FLOW.tagline} steps={ELECTRICIAN_JOB_FLOW.steps} footer={ELECTRICIAN_JOB_FLOW.footer} tone="blue" />
      <Panel accent={YELLOW} title={ELECTRICIAN_SAME_DAY.title}>
        <ul style={{ margin: 0, paddingLeft: 20 }}>{ELECTRICIAN_SAME_DAY.points.map((p) => <li key={p}>{p}</li>)}</ul>
      </Panel>
      <Panel accent={GREENA} title={ELECTRICIAN_PAY.title}>
        <ul style={{ margin: 0, paddingLeft: 20 }}>{ELECTRICIAN_PAY.points.map((p) => <li key={p}>{p}</li>)}</ul>
      </Panel>
      <Panel accent={BLUEA} title={PORTAL_ONLY_COMMS.title}>
        <ul style={{ margin: 0, paddingLeft: 20 }}>{PORTAL_ONLY_COMMS.points.map((p) => <li key={p}>{p}</li>)}</ul>
      </Panel>
      <Panel accent={PINK} title={LEAD_24H_RULE.title}>
        <ul style={{ margin: 0, paddingLeft: 20 }}>{LEAD_24H_RULE.points.map((p) => <li key={p}>{p}</li>)}</ul>
      </Panel>
      <div style={{ ...h, fontWeight: 800, fontSize: 15, margin: "16px 0 8px" }}>Common questions</div>
      <div style={{ display: "grid", gap: 8 }}>
        {ELECTRICIAN_FAQ.map((f) => (
          <details key={f.q} style={{ border: "1px solid #E4E8F0", borderRadius: 12, padding: "10px 14px", background: "#fff" }}>
            <summary style={{ fontWeight: 700, fontSize: 14, color: NAVY, cursor: "pointer" }}>{f.q}</summary>
            <p style={{ fontSize: 14, lineHeight: 1.55, color: MUTED, margin: "8px 0 2px" }}>{f.a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
