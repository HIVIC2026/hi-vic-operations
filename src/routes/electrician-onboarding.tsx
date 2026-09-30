import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { submitElectricianOnboarding } from "@/lib/partner-intake.functions";

// Public electrician/REC partner onboarding. Same brand/design language as the installer
// onboarding; submissions land in the admin Partner Enquiries list as "electrician_rec".
const BLUE = "#3C51C4";
const GREEN = "#07BF61";
const NAVY = "#22376B";
const OFFWHITE = "#FBFCFA";

export const Route = createFileRoute("/electrician-onboarding")({
  ssr: false,
  headers: () => ({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" }),
  head: () => ({ meta: [
    { title: "Electrician Partner Onboarding — Home Insulation Victoria" },
    { name: "description", content: "Apply to become an approved HI VIC electrician / REC partner." },
    { property: "og:title", content: "Electrician Partner Onboarding — Home Insulation Victoria" },
    { property: "og:description", content: "Apply to become an approved HI VIC electrician / REC partner." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: ElectricianOnboarding,
});

const labelStyle: React.CSSProperties = { display: "block", fontWeight: 600, fontSize: 14, color: NAVY, marginBottom: 6 };
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #D7DCE8",
  fontSize: 15, fontFamily: "inherit", color: NAVY, background: "#fff", boxSizing: "border-box",
};

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={labelStyle}>{label}{required && <span style={{ color: BLUE }}> *</span>}</label>
      {children}
    </div>
  );
}

function ElectricianOnboarding() {
  const [form, setForm] = useState({
    name: "", email: "", phone: "", company: "", service_areas: "",
    rec_registration_number: "", esv_licensed_electricians_confirmed: "", services: "",
    estimated_piesa_fee_inc_gst: "", estimated_return_visit_fee_inc_gst: "",
    booking_lead_time: "", weekly_capacity: "", notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await submitElectricianOnboarding({ data: {
        name: form.name, email: form.email, phone: form.phone, company: form.company,
        service_areas: form.service_areas || null,
        rec_registration_number: form.rec_registration_number || null,
        esv_licensed_electricians_confirmed: form.esv_licensed_electricians_confirmed === "" ? null : form.esv_licensed_electricians_confirmed === "yes",
        services: form.services || null,
        estimated_piesa_fee_inc_gst: form.estimated_piesa_fee_inc_gst ? Number(form.estimated_piesa_fee_inc_gst) : null,
        estimated_return_visit_fee_inc_gst: form.estimated_return_visit_fee_inc_gst ? Number(form.estimated_return_visit_fee_inc_gst) : null,
        booking_lead_time: form.booking_lead_time || null,
        weekly_capacity: form.weekly_capacity || null,
        notes: form.notes || null,
      } });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: OFFWHITE, fontFamily: "'Open Sans', system-ui, sans-serif", color: NAVY }}>
      <header style={{ background: NAVY, padding: "20px 24px" }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          <div style={{ color: "#fff", fontWeight: 800, fontSize: 20, letterSpacing: 0.2 }}>Home Insulation Victoria</div>
          <div style={{ color: "#B9C4E8", fontSize: 13, marginTop: 2 }}>Electrician / REC Partner Onboarding</div>
        </div>
      </header>

      <main style={{ maxWidth: 640, margin: "0 auto", padding: "32px 20px 64px" }}>
        {done ? (
          <div style={{ background: "#fff", borderRadius: 16, padding: 32, border: "1px solid #E4E8F0", textAlign: "center" }}>
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: GREEN, color: "#fff", fontSize: 28, lineHeight: "56px", margin: "0 auto 16px" }}>✓</div>
            <h1 style={{ fontSize: 22, margin: "0 0 8px", color: NAVY }}>Application received</h1>
            <p style={{ fontSize: 15, lineHeight: 1.6, color: "#4A5578", margin: 0 }}>
              Thanks — your electrician application has been sent to the HI VIC office. We'll review your details and be in touch to discuss rates, service areas and next steps.
            </p>
          </div>
        ) : (
          <form onSubmit={onSubmit} style={{ background: "#fff", borderRadius: 16, padding: 28, border: "1px solid #E4E8F0" }}>
            <h1 style={{ fontSize: 22, margin: "0 0 6px", color: NAVY }}>Become an HI VIC electrician partner</h1>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: "#4A5578", marginTop: 0, marginBottom: 24 }}>
              Tell us about your business. Once we've agreed rates and onboarding, you'll be able to receive assessment and PIESA work through the HI VIC portal.
            </p>

            <Field label="Your name" required><input style={inputStyle} required value={form.name} onChange={set("name")} /></Field>
            <Field label="Business / company name" required><input style={inputStyle} required value={form.company} onChange={set("company")} /></Field>
            <Field label="Email" required><input style={inputStyle} type="email" required value={form.email} onChange={set("email")} /></Field>
            <Field label="Phone" required><input style={inputStyle} type="tel" required value={form.phone} onChange={set("phone")} /></Field>
            <Field label="REC registration number" required>
              <input style={inputStyle} required value={form.rec_registration_number} onChange={set("rec_registration_number")} placeholder="e.g. 37596" />
            </Field>
            <Field label="Do you have ESV-licensed electricians?" required>
              <select style={inputStyle} required value={form.esv_licensed_electricians_confirmed} onChange={set("esv_licensed_electricians_confirmed")}>
                <option value="">Select…</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </Field>
            <Field label="Service areas (suburbs / regions)">
              <textarea style={{ ...inputStyle, minHeight: 70 }} value={form.service_areas} onChange={set("service_areas")} placeholder="e.g. Melton, Caroline Springs, Fraser Rise" />
            </Field>
            <Field label="Services you offer">
              <textarea style={{ ...inputStyle, minHeight: 70 }} value={form.services} onChange={set("services")} placeholder="e.g. PIESA assessments, switchboard upgrades, downlight replacements" />
            </Field>
            <Field label="Indicative PIESA fee (inc GST)">
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.estimated_piesa_fee_inc_gst} onChange={set("estimated_piesa_fee_inc_gst")} placeholder="e.g. 275.00" />
            </Field>
            <Field label="Indicative return visit fee (inc GST)">
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.estimated_return_visit_fee_inc_gst} onChange={set("estimated_return_visit_fee_inc_gst")} placeholder="e.g. 150.00" />
            </Field>
            <Field label="Typical booking lead time"><input style={inputStyle} value={form.booking_lead_time} onChange={set("booking_lead_time")} placeholder="e.g. 1 week" /></Field>
            <Field label="Weekly capacity"><input style={inputStyle} value={form.weekly_capacity} onChange={set("weekly_capacity")} placeholder="e.g. 10 assessments per week" /></Field>
            <Field label="Anything else we should know">
              <textarea style={{ ...inputStyle, minHeight: 90 }} value={form.notes} onChange={set("notes")} />
            </Field>

            {error && <p style={{ color: "#B3261E", fontSize: 14, margin: "0 0 14px" }}>{error}</p>}

            <button type="submit" disabled={busy} style={{
              width: "100%", padding: "14px 20px", borderRadius: 12, border: "none", cursor: busy ? "default" : "pointer",
              background: busy ? "#9AA6D8" : BLUE, color: "#fff", fontWeight: 700, fontSize: 16, fontFamily: "inherit",
            }}>
              {busy ? "Sending…" : "Submit application"}
            </button>
            <p style={{ fontSize: 12, color: "#7A84A3", marginTop: 14, marginBottom: 0, lineHeight: 1.5 }}>
              Your details go straight to the HI VIC office for review. Submitting this form does not create a job or any obligation.
            </p>
          </form>
        )}
      </main>
    </div>
  );
}
