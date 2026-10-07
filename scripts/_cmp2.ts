import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
const { loadTodos } = await import("../src/lib/todo.server");
const { loadOffice } = await import("../src/lib/office.server");
const [todos, off] = await Promise.all([loadTodos(admin), loadOffice(admin, { includeTest: false })]);
const nm = off.needs.items; const nmText = nm.map((i) => `${i.what} ${i.why}`).join("\n").toLowerCase();
const nmJobs = new Set(nm.map((i) => i.jobId).filter(Boolean));
console.log("NM non-job:", nm.filter((i) => !i.jobId).map((i) => `${i.rule}:${i.what}`).join(" ; "));
for (const t of todos) {
  if (t.jobId && nmJobs.has(t.jobId)) continue;
  if (t.key.startsWith("stage:") && t.title.startsWith("Arrange the free installer Ready Check")) continue; // counted in "enquiries not contacted" rows
  const name = t.title.split(" – ").slice(1).join(" – ").trim().toLowerCase();
  if (name && nmText.includes(name)) continue;
  console.log("MISSING", t.key.split(":")[0], "|", t.category, "|", t.jobNumber ?? "-", "|", t.title);
}
process.exit(0);
