// AI reading of one uploaded PDF/photo for Add a job (readBulkFile). Nothing is stored or sent.
class BulkImportError extends Error {}

function lovableProvider() {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new BulkImportError("AI reading is not configured (missing key). The office can still enter rows one at a time.");
  return import("@ai-sdk/openai").then(({ createOpenAI }) => createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1", apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
  }));
}
const AI_OPTIONS = { openai: { store: false, forceReasoning: true, reasoningEffort: "low", reasoningSummary: "auto", include: ["reasoning.encrypted_content"] } } as const;

const MEDIA_PROMPT = `You are reading one file an insulation installer uploaded (a PDF, a scanned page or a photo).
Write out, as plain text, every customer name, street address, suburb, postcode, phone, email, measured ceiling area (m2),
measurement method and date, existing insulation and R-value, whether removal is needed and removal area (m2), ceiling access,
roof type, hazards, building age, quoted price inc GST and exactly what that price includes. For a list or
table, write one line per customer. Free-text notes and paragraphs count too: read every sentence and copy out any of
those details mentioned in it. Copy what is written; never guess. If nothing like that is visible, reply with
exactly NONE followed by a few words describing the picture.`;

/** AI vision/PDF reading of one uploaded file → plain text for the lead finder. Matching/sorting only, never evidence. */
export async function aiReadMedia(name: string, mime: string, base64: string): Promise<string> {
  const provider = await lovableProvider();
  const { streamText } = await import("ai");
  const part = mime === "application/pdf"
    ? ({ type: "file", filename: name, data: base64, mediaType: "application/pdf" } as const)
    : ({ type: "image", image: new URL(`data:${mime};base64,${base64}`) } as const);
  const result = streamText({
    model: provider.responses("openai/gpt-6-astra"),
    instructions: MEDIA_PROMPT,
    messages: [{ role: "user", content: [{ type: "text", text: `File name: ${name}` }, part] }],
    providerOptions: AI_OPTIONS,
  });
  return (await result.text).trim();
}
