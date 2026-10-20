import { describe, expect, test } from "bun:test";
import { authorizedStoredDoc, buildDocumentIndex, categoriseDocument, visibleTo, type JobSources } from "../src/lib/jobfile.core";

const J = "job-fake";
const src = (documents: Record<string, unknown>[]): JobSources => ({ documents, evidenceFiles: [], piesaRecords: [], piesaDeliveries: [], measurements: [], quotes: [], invoices: [], assignments: [], authorities: [], escNotifications: [], veec: [], propertyFacts: [], declarations: [] });
const doc = (id: string, kind: string, title: string) => ({ id, kind, title, storage_path: `${J}/${id}.pdf`, created_at: "2026-10-01T00:00:00Z" });

const misleading = [
  doc("q1", "quote", "PIESA quote"), doc("q2", "quote", "Electrical rectification quote"), doc("q3", "quote", "Measure-up quote"), doc("q4", "quote", "Floor plan quote"),
  doc("i1", "invoice", "Electrical works invoice"), doc("i2", "payment", "PIESA payment receipt"), doc("i3", "xero_invoice", "Measured area invoice"),
  doc("u1", "installer_import", "PIESA quote.pdf"), doc("u2", "installer_import", "electrical measure-up.jpg"), doc("x1", "mystery", "PIESA certificate"), doc("x2", "", "Measure sketch"),
];

describe("financial kinds beat misleading titles", () => {
  test("categoriseDocument never gives trades a quote/invoice", () => {
    expect(categoriseDocument("quote", "PIESA quote").audience).toEqual(["owner"]);
    expect(categoriseDocument("invoice", "Electrical works invoice").audience).toEqual(["owner"]);
  });
  for (const role of ["installer", "electrician"] as const) test(`${role}: index hides them and the signer denies every one`, () => {
    const s = src(misleading);
    expect(visibleTo(buildDocumentIndex(s), role).map((d) => d.id)).toEqual([]);
    for (const d of misleading) expect(authorizedStoredDoc(s, role, `documents:${d.id}`)).toBeNull();
  });
  test("owner still opens own quotes/invoices; admin opens everything", () => {
    const s = src(misleading);
    for (const id of ["q1", "i1", "i2"]) expect(authorizedStoredDoc(s, "owner", `documents:${id}`)?.id).toBe(`documents:${id}`);
    for (const d of misleading) expect(authorizedStoredDoc(s, "admin", `documents:${d.id}`)).not.toBeNull();
  });
});

describe("real electrical safety files stay available", () => {
  const safety = [doc("p1", "piesa_certificate", "Safety check"), doc("c1", "coes", "Certificate of electrical safety"), doc("m1", "mitti_report", "Mitti PIESA report"), doc("pi1", "piisa", "PIISA")];
  for (const role of ["installer", "electrician", "owner"] as const) test(`${role} opens PIESA/COES/PIISA/Mitti PIESA`, () => {
    const s = src(safety);
    for (const d of safety) expect(authorizedStoredDoc(s, role, `documents:${d.id}`)).not.toBeNull();
  });
  test("signer denies unknown ids", () => { expect(authorizedStoredDoc(src([]), "installer", "documents:nope")).toBeNull(); });
});
