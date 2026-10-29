// Retired-term and conflict scan. Usage: bun scripts/scan-retired-terms.ts [--json]
// Fails (exit 1) on retired wording in customer-visible files; warns for internal identifiers, tests and docs.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
type Kind = "customer-visible" | "test-only" | "doc-only" | "internal-identifier";
type Hit = { file: string; line: number; term: string; kind: Kind; action: string };

const TERMS: { term: string; re: RegExp; action: string; strict?: boolean }[] = [
  { term: "Retired Ready Check service name", re: /measure[- ]up (?:&amp;|&|and) eligibility check/gi, action: "Use Ready Check", strict: true },
  {
    term: "HI VIC / HI VIC! / HIVIC",
    re: /\bHI ?VIC!?(?![a-z_])/g,
    action: 'Replace visible text with "Home Insulation Victoria"',
  },
  // $349 is the CUSTOMER PIESA price, never an electrician fee/payout (owner decision 2026-10-04). Strict in all src.
  { term: "$349 electrician fee", re: /\$?349[^\n]{0,40}(electrician|REC) (fee|payout|rate)|(electrician|REC) (fee|payout|rate)[^\n]{0,40}\$?349|Agreed fee: \$/gi, action: "Electricians see only their own agreed rate (electricianRateText)", strict: true },
  // Retired payment rule (owner decision 2026-10-03). strict = fails in ANY src file, comments included.
  { term: "50% deposit", re: /50 ?% deposit|deposit[^.\n]{0,20}50 ?%|50 ?% of (this|the) invoice/gi, action: "Replace with the approved payment-option gate", strict: true },
  { term: "total / 2", re: /total(_inc_gst)?\)? ?\/ ?2\b/g, action: "Deposit is the configured minimum (requiredDepositCents)", strict: true },
  { term: "deposit_pct: 0.5", re: /deposit_pct:? ?0?\.50*\b|deposit_pct \?\? 0\.5/g, action: "Deposit % comes from depositPctFor", strict: true },
  { term: "AmountPaid >= 50%", re: /AmountPaid\s*(>=|≥)\s*(50 ?%?|0?\.5)/gi, action: "Retired PIESA unlock rule", strict: true },
  { term: "Waiting on 50% deposit payment in Xero", re: /Waiting on 50 ?% deposit/gi, action: "Retired status text", strict: true },
  { term: "Owner to pay 50% deposit", re: /Owner to pay 50 ?%/gi, action: "Retired next action", strict: true },
  { term: "Booking opens as soon as your 50% deposit", re: /Booking opens as soon as your 50/gi, action: "Retired owner text", strict: true },
  { term: "Locked - awaiting owner's 50% deposit", re: /awaiting owner'?s 50/gi, action: "Retired trade text", strict: true },
  {
    term: "combined Ready Check + PIESA",
    re: /combined ready check|ready check \+ piesa/gi,
    action: "Retired combined visit",
  },
  {
    term: "PIESA before quote/payment",
    re: /piesa before (quote|payment)/gi,
    action: "Retired order",
  },
  {
    term: "existing insulation automatic fail",
    re: /existing insulation (automatic fail|= ?fail)/gi,
    action: "Existing insulation Yes is never an automatic fail",
  },
  {
    term: "previous upgrade automatic fail",
    re: /previous upgrade automatic fail/gi,
    action: "Previous upgrade Yes goes to office review",
  },
  {
    term: "portal-only chat required",
    re: /portal-only chat required/gi,
    action: "Direct contact with portal booking record",
  },
  // Decision 396 (Jo 26 Oct 2026): missing Ready Check photos are no longer chased as install-day photos; the A5 asks the
  // legally required ruler photos itself (install-evidence.core rulerPhotoEvaluation).
  { term: "install-day photo chase", re: /installDayPhotoNeeds|installDayPhotoBlocker|INSTALL_PHOTO_LOCK|ensureInstallDayPhotos/g, action: "Decision 396: the A5 ruler photos (rulerPhotoEvaluation); old chase rows are ignored (isRetiredInstallDayPhotoRow)", strict: true },
  // Decision 281 (Jo 25 Oct 2026): no "Fix details" pile or buttons — the portal completes addresses itself.
  { term: "Fix details pile / button", re: /Fix details/g, action: "Decision 281: one Enquiries list; addresses complete automatically (address-complete.core)" },
  { term: "Office tells the trades the electrician-at-start day", re: /tell the installer and electrician the day/g, action: "Decision 327: the electrician is asked automatically once the install day is booked (install-attendance.core)" },
  // Decisions 283/285 (Jo 25 Oct 2026): no priority number and no chip panel on Enquiries.
  { term: "Enquiries priority number / chip panel", re: /1 = hottest|Pick as many as you like · every column is sortable · 1/g, action: "Decisions 283/285: sort hottest first silently; headings filter (286)" },
  // Batch 3a (Jo 29 Oct 2026): the payment steps are safety check, fixes, 10% install deposit, balance. No deposit tiers, no plan, no Xero deposit request.
  { term: "3-instalment plan", re: /3-instalment plan/gi, action: "Retired: payment steps are safety check, fixes, 10% install deposit, balance" },
  { term: "minimum upfront deposit", re: /minimum upfront deposit/gi, action: "Retired: say the 10% install deposit" },
  { term: "deposit request in Xero", re: /deposit request in Xero|requested in Xero/gi, action: "Retired: no Xero deposit request step (decisions 139-144)" },
  // Batch 3b (Jo 29 Oct 2026): fixes and repeat safety checks have their own invoices; nothing is added to the install invoice.
  { term: "fixes / repeat added to the Xero invoice", re: /(?:fixes|repeat (?:safety check|PIESA))[^.\n]{0,60}added (?:as (?:one|a) line )?to the (?:same |ONE |job's )?(?:Xero )?invoice|add (?:it|the fixes|the repeat[^.\n]{0,20}) to the SAME Xero invoice/gi, action: "Retired: fixes and repeat checks are their own invoices (batch 3b)" },
  {
    term: "$220 lead fee",
    re: /\$220 lead fee/gi,
    action: "Not a live rule unless in the current signed agreement",
  },
];

// Approved exceptions: locked Xero reference and already-signed agreement texts (see project rules).
const ALLOWED = [/business_unit/, /'hivic'/];
// Retained internal identifiers (renaming needs separate approval): locked Xero reference prefix, rule codes,
// and Mitti question labels that the label-based sync parser matches on.
const RETAINED: { file: RegExp; re: RegExp; why: string }[] = [
  { file: /./, re: /"HIVIC-[A-Z-]+"/, why: "Internal rule code" },
  {
    file: /^src\/lib\/mitti-forms\.core\.ts$/,
    re: /HI VIC/,
    why: "Mitti label matched by sync parser",
  },
];
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".output",
  ".lovable",
  "drizzle",
  "integrations",
  ".vinxi",
  ".tanstack",
  ".workspace",
]);
const EXT = /\.(tsx?|md|html|sql|json)$/;
const SELF = new Set([
  "scripts/scan-retired-terms.ts",
  "docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md",
  "src/config/workflow-decisions.ts",
  "src/routeTree.gen.ts",
]);

function kindOf(file: string, text: string, strict = false): Kind {
  if (file.startsWith("tests/")) return "test-only";
  if (file.startsWith("docs/") || file.endsWith(".md")) return "doc-only";
  const line = text.trim();
  if (RETAINED.some((r) => r.file.test(file) && r.re.test(text))) return "internal-identifier";
  if (strict && /^(src|scripts)\//.test(file)) return "customer-visible";
  if (/^(\/\/|\*|\/\*|--)/.test(line)) return "internal-identifier";
  if (/^src\/(routes|components)\/.*\.tsx$/.test(file)) return "customer-visible";
  if (/["'`>][^"'`<]*HI ?VIC|HI ?VIC[^"'`<]*["'`<]/.test(text) || file.endsWith(".html"))
    return "customer-visible";
  return "internal-identifier";
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.test(name)) out.push(p);
  }
  return out;
}

export function scan(): Hit[] {
  const hits: Hit[] = [];
  for (const dir of ["src", "docs", "tests", "AGENTS.md"].map((d) => join(ROOT, d))) {
    let files: string[] = [];
    try {
      files = statSync(dir).isDirectory() ? walk(dir) : [dir];
    } catch {
      continue;
    }
    for (const abs of files) {
      const file = relative(ROOT, abs);
      if (SELF.has(file) || file.startsWith("docs/pending-migrations/")) continue;
      readFileSync(abs, "utf8")
        .split("\n")
        .forEach((text, i) => {
          if (ALLOWED.some((a) => a.test(text))) return;
          for (const t of TERMS) {
            t.re.lastIndex = 0;
            if (t.re.test(text))
              hits.push({
                file,
                line: i + 1,
                term: t.term,
                kind: kindOf(file, text, t.strict),
                action: t.action,
              });
          }
        });
    }
  }
  return hits;
}

if (import.meta.main) {
  const hits = scan();
  if (process.argv.includes("--json")) console.log(JSON.stringify(hits, null, 2));
  else
    for (const h of hits)
      console.log(
        `${h.kind === "customer-visible" ? "FAIL" : "WARN"} ${h.file}:${h.line} [${h.kind}] ${h.term} -> ${h.action}`,
      );
  const failing = hits.filter((h) => h.kind === "customer-visible");
  console.log(`\n${hits.length} matches, ${failing.length} customer-visible (failing).`);
  process.exit(failing.length ? 1 : 0);
}
