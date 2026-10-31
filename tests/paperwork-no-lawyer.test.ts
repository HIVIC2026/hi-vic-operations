import { describe, expect, test } from "bun:test";
import { GATE_DOCS, PAPERWORK_SCREENS } from "../src/lib/owner-gates.core";
import {
  applyPaperworkRename,
  rollbackPaperworkRename,
  paperworkRenameDb,
  matchingApprovals,
  signedRecords,
  NEW_PAPERWORK_VERSION,
  OLD_PAPERWORK_VERSION,
  APPROVER,
} from "./helpers/pglite-paperwork-rename";

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

describe("owner paperwork has no retired approval wording", () => {
  test("every document version, approval note, title and body", () => {
    for (const doc of GATE_DOCS) {
      for (const value of [doc.version, doc.approvalNote ?? "", doc.title, doc.body]) {
        expect(value).not.toMatch(/lawyer/i);
      }
    }
  });
  test("every paperwork screen string", () => {
    for (const value of strings(PAPERWORK_SCREENS)) expect(value).not.toMatch(/lawyer/i);
  });
});

describe("pending paperwork rename (PGlite only)", () => {
  test("copies exact approvals, retains approver/time, preserves signed history and is repeat-safe", async () => {
    const db = await paperworkRenameDb();
    try {
      const signed = await signedRecords(db);
      const old = (
        await db.query(
          "SELECT doc_key, body_sha256, approved_by, approved_at FROM owner_paperwork_approvals WHERE doc_version = $1 ORDER BY doc_key",
          [OLD_PAPERWORK_VERSION],
        )
      ).rows;
      expect(old).toHaveLength(11);
      await applyPaperworkRename(db);
      await applyPaperworkRename(db);
      expect(
        (
          await db.query(
            "SELECT doc_key, body_sha256, approved_by, approved_at FROM owner_paperwork_approvals WHERE doc_version = $1 ORDER BY doc_key",
            [NEW_PAPERWORK_VERSION],
          )
        ).rows,
      ).toEqual(old);
      const approved = await matchingApprovals(db);
      for (const doc of GATE_DOCS.filter((doc) => doc.version === NEW_PAPERWORK_VERSION))
        expect(approved[doc.key]).toBe(NEW_PAPERWORK_VERSION);
      expect(approved.payment_terms).toBeUndefined();
      expect(await signedRecords(db)).toEqual(signed);
      expect(
        (
          await db.query(
            "SELECT doc_key, body_sha256, approved_by, approved_at FROM owner_paperwork_approvals WHERE doc_version = $1 ORDER BY doc_key",
            [OLD_PAPERWORK_VERSION],
          )
        ).rows,
      ).toEqual(old);
      const rights = (
        await db.query(
          "SELECT version, source_note, body, approved, approved_by FROM compliance_templates WHERE template_key='consumer_rights'",
        )
      ).rows;
      expect(rights).toEqual([
        {
          version: NEW_PAPERWORK_VERSION,
          source_note: "Approved by Jo, 6 Oct 2026",
          body: "unchanged consumer rights",
          approved: true,
          approved_by: APPROVER,
        },
      ]);
      await expect(
        db.exec(
          "UPDATE compliance_templates SET body='changed' WHERE template_key='consumer_rights'",
        ),
      ).rejects.toThrow("immutable");
      await expect(
        db.exec("UPDATE owner_paperwork_approvals SET body_sha256='changed'"),
      ).rejects.toThrow("permanent");
      await expect(db.exec("DELETE FROM owner_gate_signatures")).rejects.toThrow("permanent");
      await rollbackPaperworkRename(db);
      await rollbackPaperworkRename(db);
      expect(
        (
          await db.query(
            "SELECT version FROM compliance_templates WHERE template_key='consumer_rights'",
          )
        ).rows,
      ).toEqual([{ version: OLD_PAPERWORK_VERSION }]);
      expect((await db.query("SELECT * FROM owner_paperwork_approvals")).rows).toHaveLength(22);
      expect(await signedRecords(db)).toEqual(signed);
      await applyPaperworkRename(db);
      expect((await matchingApprovals(db)).quote_acceptance).toBe(NEW_PAPERWORK_VERSION);
    } finally {
      await db.close();
    }
  });

  test("hash mismatches never become approved and unrelated versions/templates stay unchanged", async () => {
    const db = await paperworkRenameDb();
    try {
      await db.exec(
        "INSERT INTO owner_paperwork_approvals (doc_key, doc_version, body_sha256, approved_by) VALUES ('payment_terms','steps-2026-11-01','wrong-hash','00000000-0000-4000-8000-000000000001'); INSERT INTO compliance_templates (template_key, version, body) VALUES ('esc_consent','lawyer-2026-10-06-v1','unchanged legacy consent');",
      );
      await applyPaperworkRename(db);
      expect((await matchingApprovals(db)).payment_terms).toBeUndefined();
      expect(
        (
          await db.query(
            "SELECT version, body FROM compliance_templates WHERE template_key='esc_consent'",
          )
        ).rows,
      ).toEqual([{ version: OLD_PAPERWORK_VERSION, body: "unchanged legacy consent" }]);
    } finally {
      await db.close();
    }
  });
});
