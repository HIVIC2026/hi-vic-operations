// Presentation-only adapter for the installer Add job intake. Everything stays in the browser tab:
// no auth, database, storage, upload, extraction or external call. Used by /installer-preview.
import type { AttachedFile } from "./job-intake";
import type { OnsiteInput } from "@/lib/onsite-ready-check.core";

type Files = { path: string; name: string; type: string }[];
export type IntakeApi = {
  getEl: (a: { data: { businessId: string } }) => Promise<{ approved: { businessId?: string; nominationId?: string; name: string; status: string; primary?: boolean }[]; pending: { businessId?: string; nominationId?: string; name: string; status: string }[] }>;
  addEl: (a: { data: { businessId: string; name: string; mobile: string; email: string; business: string } }) => Promise<{ businessId?: string | null; nominationId?: string | null; [k: string]: unknown }>;
  loadDraft: (a: { data: { importId: string; businessId: string } }) => Promise<{ status: string; files: Files; jobId: string | null; jobNumber: string | null; receipt?: unknown }>;
  create: (a: { data: { businessId: string; files: Files; text?: string; sourceSystem: string } }) => Promise<{ id: string; extracted: unknown }>;
  confirm: (a: { data: unknown }) => Promise<{ jobId: string; jobNumber?: string | null }>;
  addFiles: (a: { data: { importId: string; files: Files } }) => Promise<{ files: Files }>;
  dropFile: (a: { data: { importId: string; path: string } }) => Promise<{ files: Files }>;
  readFile: (a: { data: unknown }) => Promise<{ text: string | null }>;
  uploadFiles: (files: File[]) => Promise<AttachedFile[]>;
  /** Synthetic sample details; contact permission is never pre-ticked. */
  sampleCustomer?: Partial<OnsiteInput>;
};

export const PREVIEW_BUSINESS_ID = "preview-sample-business";

/** Fresh local-only adapter. `submitted` holds the payload the real form would have sent (never sent). */
export function createPreviewIntakeApi() {
  let files: Files = [];
  const submitted: unknown[] = [];
  const api: IntakeApi = {
    sampleCustomer: { full_name: "Sample Owner", address_line: "1 Example Street", suburb: "Melbourne", postcode: "3000", phone: "0400 000 000", email: "sample.homeowner@example.invalid" },
    getEl: async () => ({ approved: [{ businessId: "preview-electrician", name: "Sample Electrical (sample)", status: "approved", primary: true }], pending: [] }),
    addEl: async () => ({ businessId: null, nominationId: "preview-nomination", invited: false, preview: true }),
    loadDraft: async () => ({ status: "gone", files: [], jobId: null, jobNumber: null, receipt: null }),
    create: async (a) => { files = [...a.data.files]; return { id: "preview-draft", extracted: {} }; },
    confirm: async (a) => { submitted.push(a.data); return { jobId: "preview-job", jobNumber: "SAMPLE-0001" }; },
    addFiles: async (a) => { files = [...files, ...a.data.files.filter((f) => !files.some((h) => h.path === f.path))]; return { files }; },
    dropFile: async (a) => { files = files.filter((f) => f.path !== a.data.path); return { files }; },
    readFile: async () => ({ text: null }),
    uploadFiles: async (picked) => picked.map((f, i) => ({ path: `preview/${Date.now()}-${i}-${f.name}`, name: f.name, type: f.type })),
  };
  return { api, submitted };
}
