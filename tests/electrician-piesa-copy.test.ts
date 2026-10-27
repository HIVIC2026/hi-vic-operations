// Decision 317 (Jo, 25 Oct 2026): the electrician also gets the final official PIESA.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ELECTRICIAN_PIESA_EMAIL_APPROVED, ELECTRICIAN_PIESA_EVENT, electricianPiesaKey, electricianPiesaPlan, electricianPiesaVersion,
  officialPiesaPdfFilename, officialPiesaPdfText, renderElectricianPiesaEmail, type ElectricianPiesaFacts,
} from "../src/lib/electrician-piesa-copy.core";
import { SAFETY_CHECK_DOC_TITLE, safetyCheckDocLine } from "../src/lib/trade-view.core";
import { buildSignedSnapshot } from "../src/lib/official-forms.core";

const read = (f: string) => readFileSync(f, "utf8");
const base: ElectricianPiesaFacts = {
  closed: false, copy: { id: "copy-1", signedAt: "2026-11-02T03:00:00Z" }, record: { id: "rec-1", kind: "initial", createdAt: "2026-11-02T02:00:00Z" },
  electrician: { email: "sparky@example.com" }, alreadySent: false,
};

describe("when the electrician's copy is due (pure)", () => {
  test("approved by Jo", () => { expect(ELECTRICIAN_PIESA_EMAIL_APPROVED).toBe(true); });
  test("first official PIESA → one initial send keyed to the PIESA record", () => {
    expect(electricianPiesaPlan(base)).toEqual({ send: true, key: "electrician-piesa:v1:rec-1", version: "initial", recordId: "rec-1", copyId: "copy-1" });
  });
  test("holds: closed job, no official PIESA, no record, no electrician, already sent, no email", () => {
    const r = (f: Partial<ElectricianPiesaFacts>) => { const p = electricianPiesaPlan({ ...base, ...f }); return p.send ? null : p.reason; };
    expect(r({ closed: true })).toBe("job closed or archived");
    expect(r({ copy: null })).toBe("no official PIESA on this job yet");
    expect(r({ record: null })).toBe("no current PIESA record");
    expect(r({ electrician: null })).toBe("no electrician on the job");
    expect(r({ alreadySent: true })).toBe("already sent for this PIESA record");
    expect(r({ electrician: { email: "  " } })).toBe("no email address for the electrician");
  });
  test("post-fixes record: only once the official PIESA was regenerated after it, then once more with a new key", () => {
    const post = { ...base, record: { id: "rec-2", kind: "post_rectification", createdAt: "2026-11-10T01:00:00Z" } };
    const waiting = electricianPiesaPlan({ ...post, copy: { id: "copy-1", signedAt: "2026-11-02T03:00:00Z" } });
    expect(waiting).toEqual({ send: false, reason: "official PIESA not regenerated after the fixes yet" });
    const p = electricianPiesaPlan({ ...post, copy: { id: "copy-2", signedAt: "2026-11-10T01:00:05Z" } });
    expect(p).toEqual({ send: true, key: "electrician-piesa:v1:rec-2", version: "after_fixes", recordId: "rec-2", copyId: "copy-2" });
    expect(electricianPiesaKey("rec-2")).not.toBe(electricianPiesaKey("rec-1"));
  });
  test("version from the record kind", () => {
    expect(electricianPiesaVersion("initial")).toBe("initial");
    expect(electricianPiesaVersion("post_rectification")).toBe("after_fixes");
    expect(electricianPiesaVersion("reassessment")).toBe("initial");
  });
});

describe("wording (decision 317, verbatim)", () => {
  test("first official PIESA", () => {
    const m = renderElectricianPiesaEmail({ address: "12 Smith St, Preston", jobNumber: "HV-2001", version: "initial" });
    expect(m.subject).toBe("Your safety check for 12 Smith St, Preston (HV-2001)");
    expect(m.text).toContain("Here's the official Pre Insulation Electrical Safety Assessment (PIESA) for 12 Smith St, Preston, as filed for this job.\n\nKeep it with your records.");
    expect(m.html).toContain(">Your safety check for <span style=\"white-space:nowrap;\">HV-2001</span><");
    expect(m.text).not.toContain("This version includes");
    expect(m.html).toContain("Home Insulation Victoria");
    expect(m.html).not.toMatch(/<a [^>]*href="http/); // no links in the body (the shared head's font links aside)
    expect(m.html).not.toMatch(/\$\d/);
  });
  test("post-fixes version adds the fixes sentence", () => {
    const m = renderElectricianPiesaEmail({ address: "12 Smith St, Preston", jobNumber: "HV-2001", version: "after_fixes", test: true });
    expect(m.text).toContain("This version includes your electrical fixes and Certificate of Electrical Safety.");
    expect(m.html).toContain("TEST");
  });
});

describe("the official PIESA PDF text and the /field row label", () => {
  test("form order, statements verbatim, answers shown, signer + hashes", () => {
    const snap = buildSignedSnapshot({ key: "piesa", answers: {}, signer: { userId: "u1", name: "Sam Sparks", role: "electrician" }, enteredDate: "2026-11-02", serverTimestamp: "2026-11-02T03:00:00Z", jobFacts: {}, acknowledgementIds: [], signature: "x" });
    const t = officialPiesaPdfText(snap);
    expect(t).toContain(snap.document.find((d) => d.kind === "statement")!.label);
    expect(t).toContain("Signed by Sam Sparks (electrician) on 2026-11-02.");
    expect(t).toContain(snap.documentSha256);
    expect(officialPiesaPdfText(null as never)).toContain("Signed by -");
    expect(officialPiesaPdfFilename("HV-2001")).toBe("PIESA-HV-2001.pdf");
  });
  test("row title + line", () => {
    expect(SAFETY_CHECK_DOC_TITLE).toBe("Safety check (PIESA)");
    expect(safetyCheckDocLine({ signatureDate: null, afterFixes: false })).toBe("Official copy · Download PDF");
    expect(safetyCheckDocLine({ signatureDate: "2026-11-10", afterFixes: true })).toContain("includes your fixes and CoES");
  });
});

describe("source pins", () => {
  const send = read("src/lib/electrician-piesa-copy.server.ts");
  const tv = read("src/lib/trade-view.server.ts");
  test("event recorded before any send; TEST → test-send; real → partner sender behind the master switch", () => {
    const claim = send.indexOf("await logEvent(jobId, null, ELECTRICIAN_PIESA_EVENT");
    expect(claim).toBeGreaterThan(0);
    expect(send.indexOf("sendTestEmail(")).toBeGreaterThan(claim);
    expect(send.indexOf("sendOfficeEmail(")).toBeGreaterThan(claim);
    expect(send).toContain('const test = job.source === "qa_test" || partnerIsTest;');
    expect(send).toContain('if (!(await customerCommsEnabled())) return "held: partner emails paused (master switch off)";');
    expect(send).toContain('.eq("event_type", ELECTRICIAN_PIESA_EVENT).contains("details", { key })');
    expect(send).toContain('.eq("role", "electrician").eq("active", true)');
    expect(ELECTRICIAN_PIESA_EVENT).toBe("electrician_piesa_copy_sent");
  });
  test("the attachment and the /field download are the same PDF builder; no public URL", () => {
    expect(send).toContain('officialPiesaPdf(jobId, job.job_number)');
    expect(tv).toContain('(await import("./official-piesa-pdf.server")).officialPiesaPdf(jobId, job.job_number)');
    const pdf = read("src/lib/official-piesa-pdf.server.ts");
    expect(pdf).not.toMatch(/getPublicUrl|signFile|sendOfficeEmail|sendTestEmail/);
  });
  test("trade read path: electricians only, business-scoped, never a sender", () => {
    const body = tv.slice(tv.indexOf("export async function tradeSafetyCheckDoc"));
    expect(body).toContain("const c = await requireJobElectrician(jobId, userId);");
    expect(tv).toContain('.eq("role", "electrician").eq("business_id", c.biz.id).eq("active", true)');
    expect(tv).not.toContain("electrician-piesa-copy.server");
    const fns = read("src/lib/trade-view.functions.ts");
    expect(fns).toContain("tradeSafetyCheckDoc(data.jobId, context.userId)");
    expect(fns).toContain("tradeSafetyCheckPdf(data.jobId, context.userId)");
    expect(fns).not.toContain("@tanstack/react-start/server");
    expect(read("src/routes/_authenticated/field.$jobId.tsx")).toContain('{role === "electrician" && <SafetyCheckDocRow jobId={jobId} />}');
  });
  test("wired: A4 completion after the regeneration, and the 15-minute tick; O28 untouched", () => {
    const fd = read("src/lib/fixes-day.server.ts");
    expect(fd.indexOf("sendElectricianPiesaCopy(jobId)")).toBeGreaterThan(fd.indexOf("regenerateOfficialPiesa(jobId, actorId, merged"));
    expect(read("src/routes/api/public/hooks/allocation-tick.ts")).toContain("sweepElectricianPiesaCopies()");
    expect(read("src/lib/piesa-delivery.server.ts")).not.toContain("electrician");
  });
});
