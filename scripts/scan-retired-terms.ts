// Retired-term and conflict scan. Usage: bun scripts/scan-retired-terms.ts [--json]
// Fails (exit 1) on retired wording in customer-visible files; warns for internal identifiers, tests and docs.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
type Kind = "customer-visible" | "test-only" | "doc-only" | "internal-identifier";
type Hit = { file: string; line: number; term: string; kind: Kind; action: string };

type Term = { term: string; re: RegExp; action: string; strict?: boolean; quoted?: boolean };
// Global owner wording rules (Jo 2 Nov 2026, docs/hiv-touchpoint-decisions-2026-11-02.md). Strict in all src, comments included.
export const OWNER_WORDING_TERMS: Term[] = [
  { term: "Thousands of Victorians", re: /Thousands of Victorians/g, action: 'Delete; keep "Spots are released in the order they were saved."', strict: true },
  { term: "lower power bills", re: /lower (?:power )?bills/gi, action: "Delete the claim", strict: true },
  { term: "VEU discount", re: /VEU discount/g, action: 'Say "rebate" ("Rebate" as a label)', strict: true },
  { term: "old price label", re: /Your cost if eligible|Your estimated cost after rebate/g, action: "Your estimated quote based on what you've told us", strict: true },
  {
    term: "fixes wording to owners",
    re: /Electrical fixes, if the safety check finds any|electrical fixes, only if the safety check finds any|finds something to fix|Only if something needs fixing|Licensed electrician safety check/g,
    action: 'Say "electrical upgrades" and "electrical safety check (PIESA)"',
    strict: true,
  },
  { term: "mandatory PIESA", re: /mandatory PIESA/g, action: "electrical safety check (PIESA)", strict: true },
  { term: "install duration", re: /About 4 hours|takes? (?:about )?a few hours|takes about 4 hours|How long:/g, action: "Delete (no install duration)", strict: true },
  { term: "Wrong time link", re: /Wrong time\?/g, action: "Delete (no change links)", strict: true },
  { term: "Just checking you got your estimate", re: /Just checking you got your estimate/g, action: "Delete (the day 2/7/21 reminders cover it)", strict: true },
  { term: "owner picks a Ready Check time", re: /[Ii]nstaller will offer you 3 times|will offer you 3 times to pick from|offer you 3 times for your (?:free|Free) Ready Check/g, action: "Delete (the installer will call instead)", strict: true },
  { term: "See where you're up to", re: /See where you're up to/g, action: "Delete the button (no My job home links)", strict: true },
  // Part 4 Task 14 (Jo 2 Nov 2026): no owner picks install days or safety check times, no HIV fixes quote, no held-day deposit.
  { term: "owner picks install days / safety check times", re: /Your installer will offer you 3 (?:new |install )?days|will offer you 3 (?:safety check )?times to choose from|then you can pick your install day|Pick one of the times offered/g, action: "Delete (the installer / electrician calls to book)", strict: true },
  { term: "held for 48 hours while the deposit arrives", re: /is held for 48 hours|deposit within 48 hours|Your day is held until/g, action: "Delete (answer 21: the deposit is paid before the install day is booked)", strict: true },
  {
    term: "7-day balance",
    re: /7 days after (?:your |the )?install(?:ation)? (?:is )?recorded complete|7 days after recorded install completion|due 7 days after install(?:ation)? completion/g,
    action: "The rest of your payment is due on install day (overdue still after 7 days)",
    strict: true,
  },
];

const TERMS: Term[] = [
  ...OWNER_WORDING_TERMS,
  { term: "Retired Ready Check service name", re: /measure[- ]up (?:&amp;|&|and) eligibility check/gi, action: "Use Ready Check", strict: true },
  {
    term: "HI VIC / HI VIC! / HIVIC",
    re: /\bHI ?VIC!?(?![a-z_])/g,
    action: 'Replace visible text with "Home Insulation Victoria"',
  },
  // $349 is the CUSTOMER PIESA price, never an electrician fee/payout (owner decision 2026-10-04). Strict in all src.
  { term: "$349 electrician fee", re: /\$?349[^\n]{0,40}(electrician|REC) (fee|payout|rate)|(electrician|REC) (fee|payout|rate)[^\n]{0,40}\$?349|Agreed fee: \$/gi, action: "Electricians see only their own agreed rate (electricianRateText)", strict: true },
  // Jo 5 Nov 2026: the install deposit is 50% of the price after the $349 (was 10%). The old 50%-before-PIESA rule stays
  // retired through its specific phrases below (Waiting on 50% deposit…, Owner to pay 50%…, AmountPaid >= 50%, total / 2).
  // strict = fails in ANY src file, comments included.
  { term: "10% install deposit", re: /\b10 ?% (install(ation)? )?deposit|\b10 ?% to book|\b10 ?% of the (rest|install price)|deposit \(10 ?%\)|\(10 ?%\) to book|\b90 ?% balance/gi, action: "Jo 5 Nov 2026: the deposit is 50%; owners read \"your deposit\" (Jo 6 Nov 2026), never a percentage", strict: true },
  { term: "50% of this invoice", re: /50 ?% of (this|the) invoice/gi, action: "Retired: the deposit is 50% of the price after the $349, not of the invoice", strict: true },
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
  // Batch 3a (Jo 29 Oct 2026): the payment steps are safety check, fixes, install deposit (50% since Jo 5 Nov 2026), balance. No deposit tiers, no plan, no Xero deposit request.
  { term: "3-instalment plan", re: /3-instalment plan/gi, action: "Retired: payment steps are safety check, fixes, install deposit, balance" },
  { term: "minimum upfront deposit", re: /minimum upfront deposit/gi, action: "Retired: say the install deposit" },
  { term: "deposit request in Xero", re: /deposit request in Xero|requested in Xero/gi, action: "Retired: no Xero deposit request step (decisions 139-144)" },
  // Batch 3b (Jo 29 Oct 2026): fixes and repeat safety checks have their own invoices; nothing is added to the install invoice.
  { term: "fixes / repeat added to the Xero invoice", re: /(?:fixes|repeat (?:safety check|PIESA))[^.\n]{0,60}added (?:as (?:one|a) line )?to the (?:same |ONE |job's )?(?:Xero )?invoice|add (?:it|the fixes|the repeat[^.\n]{0,20}) to the SAME Xero invoice/gi, action: "Retired: fixes and repeat checks are their own invoices (batch 3b)" },
  // Part 7 Task 9 (Jo 2 Nov 2026): the Ready Check run and job offer trade messages are gone — installers call the owner and book.
  { term: "retired Ready Check run / job offer trade texts", re: /you've got a run of|New Ready Check job near|Offer the owner 3 times within 24 hours to take it|suggested other days for their Ready Check\. Tap to pick one|an owner cancelled their Ready Check on|Owner details on the job:/g, action: "Part 7 Task 9: no job offers or runs to installers (#35, #40–43, #47, #50) — the installer calls the owner and books", strict: true },
  {
    term: "$220 lead fee",
    re: /\$220 lead fee/gi,
    action: "Not a live rule unless in the current signed agreement",
  },
  // Jo 6 Nov 2026: owners, installers and the office read "your deposit" / "the deposit" (never a percentage) and
  // "electrician" (never "usual electrician"). Fails on quoted strings in src/ and on templates; comments and names may stay.
  { term: "10% deposit", re: /10 ?% deposit/gi, action: 'Say "your deposit" / "the deposit" (Jo 6 Nov 2026); never a percentage', quoted: true },
  { term: "50% deposit", re: /50 ?% deposit/gi, action: 'Say "your deposit" / "the deposit" (Jo 6 Nov 2026); never a percentage', quoted: true },
  { term: "50% to book / install deposit / of the", re: /50 ?% (?:to book|install deposit|of the)/gi, action: 'Say "your deposit" / "the deposit" / "deposit" (Jo 6 Nov 2026); never a percentage, amounts stay', quoted: true },
  { term: "usual electrician", re: /usual electricians?\b/gi, action: 'Say "electrician" (Jo 6 Nov 2026); the legacy Mitti answer text stays only as an alias', quoted: true },
];

// Approved exceptions: locked Xero reference and already-signed agreement texts (see project rules).
const ALLOWED = [/business_unit/, /'hivic'/];
// Retained internal identifiers (renaming needs separate approval): locked Xero reference prefix, rule codes,
// and Mitti question labels that the label-based sync parser matches on.
const RETAINED: { file: RegExp; re: RegExp; why: string }[] = [
  { file: /./, re: /"HIVIC-[A-Z-]+"/, why: "Internal rule code" },
  // Jo 5–6 Nov 2026: Customer Agreement v1.3 (signed by owners, 10% deposit) and v1.4 (approved and live 5 Nov 2026, 50%
  // deposit) are kept word for word as history: v1.4 is built from v1.3 by AGREEMENT_V1_4_CHANGES and v1.5 (no percentage)
  // from v1.4 by AGREEMENT_V1_5_CHANGES; the PDF keeps both bold leads so signed v1.3/v1.4 copies still render. v1.5 needs no exception.
  { file: /^src\/lib\/customer-agreement(\.core|-pdf\.server)\.ts$/, re: /(?:10|50) ?% (deposit|to book)/, why: "Signed Customer Agreement v1.3 / v1.4 records and their change lists (new version needed)" },
  {
    file: /^src\/lib\/mitti-forms\.core\.ts$/,
    re: /HI VIC/,
    why: "Mitti label matched by sync parser",
  },
  // Signed texts: any wording change needs a new version so earlier signatures keep their exact text.
  { file: /^src\/lib\/(installer|rec)-agreement\.text\.ts$/, re: /VEU discount/, why: "Signed partner agreement text (new version needed)" },
  { file: /^src\/lib\/owner-gates\.core\.ts$/, re: /^\s*body: "I (?:accept this quote|assign to DC Construction).*VEU discount/, why: "Signed owner gate bodies quote_acceptance and veec_assignment_consent (new version needed)" },
  // Jo 6 Nov 2026 wording: the old Mitti answer text is still accepted as a legacy alias; history and audit lines are never rewritten.
  { file: /^src\/lib\/(?:usual-electrician|ready-check-lean|mitti)\.core\.ts$/, re: /"My usual electrician"/, why: "Legacy Mitti answer text kept as an alias" },
  { file: /^src\/lib\/(?:electrician-choice\.core|signup-electrician\.server|rec-auto-link\.server|mitti-electrician\.server)\.ts$/, re: /(?:summary|Summary|logEvent|the installer's usual electrician\$\{)/, why: "History / audit line (never rewritten)" },
  { file: /^src\/lib\/(?:payments\.server|deposit-request\.server|install-booked-email\.server)\.ts$/, re: /(?:once\("install_deposit_received"|summary:'|logEvent\()/, why: "History / audit line (never rewritten)" },
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

function kindOf(file: string, text: string, strict = false, quoted?: RegExp): Kind {
  if (file.startsWith("tests/")) return "test-only";
  if (file.startsWith("docs/") || file.endsWith(".md")) return "doc-only";
  const line = text.trim();
  if (RETAINED.some((r) => r.file.test(file) && r.re.test(text))) return "internal-identifier";
  if (strict && /^(src|scripts)\//.test(file)) return "customer-visible";
  if (/^(\/\/|\*|\/\*|--)/.test(line)) return "internal-identifier";
  // `quoted` terms: a hit inside a string literal (or JSX text) of src/scripts is customer-visible; a comment is not.
  if (quoted && /^(src|scripts)\//.test(file) && new RegExp(`["'\`>][^"'\`<]*(?:${quoted.source})`, "i").test(text.replace(/\s\/\/ .*$/, ""))) return "customer-visible";
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
                kind: kindOf(file, text, t.strict, t.quoted ? t.re : undefined),
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
