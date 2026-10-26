// Compile *.mjml -> dist/*.html with MJML 5 (strict, minified).
// The shared head (partials/head.mjml) is pasted in where an email's <mj-head> includes it,
// because MJML cannot include a partial inside <mj-head>. Header/footer use normal mj-include.
// Usage: node build.mjs [name ...]
import mjml2html from "mjml";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
const dir = new URL(".", import.meta.url).pathname;
const head = readFileSync(dir + "partials/head.mjml", "utf8");
const names = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(dir).filter(f => f.endsWith(".mjml")).map(f => f.slice(0, -5));
let fail = 0;
for (const n of names) {
  const src = readFileSync(dir + `${n}.mjml`, "utf8").replace('<mj-include path="./partials/head.mjml" />', head);
  try {
    const r = await mjml2html(src, { validationLevel: "strict", minify: true, allowIncludes: true, ignoreIncludes: false, includePath: [dir + "partials"], filePath: dir + `${n}.mjml` });
    const problems = [];
    if (r.errors?.length) problems.push(...r.errors.map(e => e.formattedMessage));
    const h = r.html;
    if (!h.includes("ABN 44 671 613 979")) problems.push("footer missing");
    if (!h.includes("home-insulation-victoria-logo.png")) problems.push("header missing");
    if (!h.includes("Figtree")) problems.push("shared head missing");
    if (!/<title>[^<]+<\/title>/.test(h)) problems.push("no title");
    if (h.length > 102000) problems.push(`${h.length} bytes, Gmail clips over 102KB`);
    if (/data:image/.test(h)) problems.push("embedded image");
    if (problems.length) { fail = 1; console.log(`FAIL ${n}: ${problems.join(" | ")}`); }
    writeFileSync(dir + `dist/${n}.html`, h);
  } catch (e) { fail = 1; console.log(`FAIL ${n}: ${String(e.message ?? e).slice(0, 400)}`); }
}
console.log(fail ? "BUILD FAILED" : `BUILD OK (${names.length})`);
process.exit(fail);
