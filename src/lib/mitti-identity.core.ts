// Pure Mitti template identity rules shared by setup, health, creation and audit reuse/sync.
// Invalid/missing IDs never match, including when both values are absent.
export function canonicalMittiTemplateId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim().toLowerCase();
  if (!/^(template_[a-f0-9]{32}|[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(id)) return null;
  return id.replace(/^template_/, "").replaceAll("-", "");
}

export function sameMittiTemplateId(left: unknown, right: unknown): boolean {
  const canonical = canonicalMittiTemplateId(left);
  return canonical !== null && canonical === canonicalMittiTemplateId(right);
}

const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;

export function mittiTemplateIdentity(definition: unknown): { id: string | null; name: string | null } {
  const outer = object(definition);
  const template = object(outer?.template) ?? outer;
  const data = object(template?.template_data);
  const metadata = object(data?.metadata);
  return {
    id: text(template?.template_id) ?? text(template?.id) ?? text(outer?.template_id) ?? text(outer?.id),
    name: text(template?.name) ?? text(template?.title) ?? text(metadata?.name) ?? text(template?.template_name),
  };
}
