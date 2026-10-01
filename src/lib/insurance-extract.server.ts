// Reads an uploaded Certificate of Currency with AI and returns the key details.
// Best-effort only: the partner always reviews/edits the filled fields, office verifies.
export type InsuranceExtract = {
  insured_name: string | null; insurer: string | null; policy_number: string | null;
  cover_amount: number | null; expiry: string | null; is_public_liability: boolean | null; is_product_liability: boolean | null;
};

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
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: [
          { type: "text", text: "This should be an Australian insurance Certificate of Currency. Extract the details for the PUBLIC LIABILITY cover and whether PRODUCT LIABILITY cover is explicitly included. Use null for anything not clearly shown. Never guess." },
          { type: "image_url", image_url: { url: `data:${mime};base64,${btoa(bin)}` } },
        ] }],
        tools: [{ type: "function", function: { name: "certificate", parameters: { type: "object", properties: {
          insured_name: { type: ["string", "null"], description: "Named insured business" },
          insurer: { type: ["string", "null"], description: "Insurance company / underwriter" },
          policy_number: { type: ["string", "null"] },
          cover_amount: { type: ["number", "null"], description: "Public liability limit in AUD" },
          expiry: { type: ["string", "null"], description: "Period of insurance end date, YYYY-MM-DD" },
          is_public_liability: { type: ["boolean", "null"], description: "Does it include public liability cover?" },
          is_product_liability: { type: ["boolean", "null"], description: "Does it explicitly include product liability cover?" },
        }, required: ["insured_name", "insurer", "policy_number", "cover_amount", "expiry", "is_public_liability", "is_product_liability"] } } }],
        tool_choice: { type: "function", function: { name: "certificate" } },
      }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const args = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return null;
    const o = JSON.parse(args) as InsuranceExtract;
    const str = (v: unknown, m: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, m) : null);
    return {
      insured_name: str(o.insured_name, 200), insurer: str(o.insurer, 200), policy_number: str(o.policy_number, 100),
      cover_amount: typeof o.cover_amount === "number" && Number.isFinite(o.cover_amount) && o.cover_amount > 0 ? o.cover_amount : null,
      expiry: typeof o.expiry === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.expiry) ? o.expiry : null,
      is_public_liability: typeof o.is_public_liability === "boolean" ? o.is_public_liability : null,
      is_product_liability: typeof o.is_product_liability === "boolean" ? o.is_product_liability : null,
    };
  } catch { return null; }
}
