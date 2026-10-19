// P1-R2-S06 — GAP-05: Base44 enquiry-transfer daily reconciliation (pure derivation).
// Verifies reconcileBase44Transfers() over already-logged external_sync_logs rows:
//   - successful transfer recognition (only a recorded "synced" row counts as received),
//   - duplicate delivery collapses to one enquiry (idempotent on external_enquiry_id),
//   - failed transfer handling + retryable vs unidentified failures,
//   - recovery: a later "synced" supersedes an earlier "error" (last-write-wins),
//   - missing / delayed transfer: rows outside the daily window are ignored,
//   - safe behaviour on empty / null / malformed input.
// Pure and read-only: records nothing, writes nothing, moves no job.
import { describe, expect, test } from "bun:test";
import { reconcileBase44Transfers, type SyncLogRow } from "../src/lib/office-status.core";

const NOW = Date.parse("2026-10-13T03:30:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const base = (o: Partial<SyncLogRow>): SyncLogRow => ({ system: "base44", direction: "inbound", ...o });

describe("GAP-05 Base44 enquiry transfer reconciliation", () => {
  test("recognises a successful transfer only from a recorded 'synced' row", () => {
    const r = reconcileBase44Transfers(
      [base({ status: "synced", created_at: ago(3600_000), entity_id: "job-1", payload: { external_enquiry_id: "E-1" } })],
      { now: NOW },
    );
    expect(r.received).toBe(1);
    expect(r.failed).toBe(0);
    expect(r.failedExternalIds).toEqual([]);
    expect(r.totalRows).toBe(1);
  });

  test("duplicate delivery of the same enquiry collapses to one (idempotent key)", () => {
    const rows = [
      base({ status: "synced", created_at: ago(7200_000), entity_id: "job-1", payload: { external_enquiry_id: "E-1" } }),
      base({ status: "synced", created_at: ago(3600_000), entity_id: "job-1", payload: { external_enquiry_id: "E-1" } }),
    ];
    const r = reconcileBase44Transfers(rows, { now: NOW });
    expect(r.received).toBe(1); // one distinct enquiry, not two
    expect(r.totalRows).toBe(2); // but both raw rows were considered
  });

  test("failed transfer handling: retryable (has external id) vs unidentified", () => {
    const rows = [
      base({ status: "error", created_at: ago(1000_000), error: "Validation failed", payload: { external_enquiry_id: "E-2" } }),
      base({ status: "error", created_at: ago(900_000), error: "Validation failed", payload: {} }), // no external id
    ];
    const r = reconcileBase44Transfers(rows, { now: NOW });
    expect(r.failed).toBe(2);
    expect(r.retryable).toBe(1);
    expect(r.unidentifiedFailures).toBe(1);
    expect(r.failedExternalIds).toEqual(["E-2"]);
  });

  test("recovery: a later 'synced' supersedes an earlier 'error' for the same enquiry", () => {
    const rows = [
      base({ status: "error", created_at: ago(5000_000), payload: { external_enquiry_id: "E-3" } }),
      base({ status: "synced", created_at: ago(1000_000), entity_id: "job-3", payload: { external_enquiry_id: "E-3" } }),
    ];
    const r = reconcileBase44Transfers(rows, { now: NOW });
    expect(r.received).toBe(1);
    expect(r.failed).toBe(0);
    expect(r.failedExternalIds).toEqual([]);
  });

  test("regression: a later 'error' supersedes an earlier 'synced' (still flagged failed)", () => {
    const rows = [
      base({ status: "synced", created_at: ago(5000_000), payload: { external_enquiry_id: "E-4" } }),
      base({ status: "error", created_at: ago(1000_000), payload: { external_enquiry_id: "E-4" } }),
    ];
    const r = reconcileBase44Transfers(rows, { now: NOW });
    expect(r.received).toBe(0);
    expect(r.failed).toBe(1);
    expect(r.failedExternalIds).toEqual(["E-4"]);
  });

  test("missing / delayed transfer: rows outside the daily window are ignored", () => {
    const rows = [
      base({ status: "synced", created_at: ago(2 * 86_400_000), payload: { external_enquiry_id: "OLD" } }), // 2 days old
      base({ status: "synced", created_at: ago(3600_000), payload: { external_enquiry_id: "NEW" } }),
    ];
    const r = reconcileBase44Transfers(rows, { now: NOW }); // default 24h window
    expect(r.received).toBe(1);
    expect(r.totalRows).toBe(1);
    expect(r.windowStartIso).toBe(new Date(NOW - 86_400_000).toISOString());
  });

  test("ignores rows from other systems/directions", () => {
    const rows = [
      base({ status: "synced", created_at: ago(1000_000), payload: { external_enquiry_id: "E-5" } }),
      { system: "mitti", direction: "outbound", status: "synced", created_at: ago(1000_000) } as SyncLogRow,
      { system: "base44", direction: "outbound", status: "synced", created_at: ago(1000_000) } as SyncLogRow,
    ];
    const r = reconcileBase44Transfers(rows, { now: NOW });
    expect(r.received).toBe(1);
    expect(r.totalRows).toBe(1);
  });

  test("safe on empty / null / undefined / malformed input", () => {
    for (const bad of [[], null, undefined]) {
      const r = reconcileBase44Transfers(bad as SyncLogRow[] | null, { now: NOW });
      expect(r.received).toBe(0);
      expect(r.failed).toBe(0);
      expect(r.totalRows).toBe(0);
      expect(r.failedExternalIds).toEqual([]);
    }
    // malformed rows (bad dates, missing fields) must never throw and never count
    const r = reconcileBase44Transfers(
      [base({ status: "synced", created_at: "not-a-date" }), base({ status: "synced" }) as SyncLogRow],
      { now: NOW },
    );
    expect(r.totalRows).toBe(0);
  });
});
