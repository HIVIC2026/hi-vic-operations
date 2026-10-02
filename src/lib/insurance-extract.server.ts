// Reads an uploaded Certificate of Currency with AI and returns the key details.
// Best-effort only: the partner always reviews/edits the filled fields, office verifies.
import { normaliseExtract, type InsuranceExtract } from "./insurance-reading.core";
export type { InsuranceExtract };

type Db = { storage: { from: (b: string) => { download: (p: string) => Promise<{ data: Blob | null; error: unknown }> } } };

export async function extractInsurance(db: Db, path: string): Promise<InsuranceExtract | null> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) return null;
  try {
    const { data: blob } = await db.storage.from("partner-files").download(path);
    if (!blob) return null;
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    const mime = path.endsWith(".pdf") ? "application/pdf" : path.endsWith(".png") ? "image/png" : "image/jpeg";
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [{ role: "user", content: [
          { type: "text", text: "This should be an Australian insurance Certificate of Currency. Read every page carefully, including tables. Extract the details for the PUBLIC LIABILITY (also called 'General Liability', 'Broadform Liability' or 'Public & Products Liability') section only. Rules: insured_name = the named insured / policyholder business. insurer = the insurance company or underwriter (e.g. 'QBE Insurance (Australia) Limited'), not the broker, agent or intermediary. cover_amount = the public liability limit (labels like 'Limit of Liability', 'Limit of Indemnity', 'Sum Insured', 'any one occurrence'), copied exactly as printed (e.g. \"$20,000,000\" or \"$20M\") — not the products aggregate, professional indemnity, or the excess/deductible. expiry = the period of insurance END date (labels like 'Period of Insurance … to', 'Expiry', 'Valid until', 'To 4pm'), copied exactly as printed; Australian dates are day/month/year. policy_number = the public liability policy number. If a value is printed, return it even if formatting is unusual. Use null only when it truly isn't shown. Never guess or calculate." },
          { type: "image_url", image_url: { url: `data:${mime};base64,${btoa(bin)}` } },
        ] }],
        tools: [{ type: "function", function: { name: "certificate", parameters: { type: "object", properties: {
          insured_name: { type: ["string", "null"], description: "Named insured business" },
          insurer: { type: ["string", "null"], description: "Insurance company / underwriter" },
          policy_number: { type: ["string", "null"] },
          cover_amount: { type: ["string", "null"], description: "Public liability per-occurrence limit exactly as printed" },
          expiry: { type: ["string", "null"], description: "Period of insurance end date exactly as printed (day/month/year)" },
          is_public_liability: { type: ["boolean", "null"], description: "Does it include public liability cover?" },
        }, required: ["insured_name", "insurer", "policy_number", "cover_amount", "expiry", "is_public_liability"] } } }],
        tool_choice: { type: "function", function: { name: "certificate" } },
      }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const args = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return null;
    return normaliseExtract(JSON.parse(args) as Record<string, unknown>);
  } catch { return null; }
}
