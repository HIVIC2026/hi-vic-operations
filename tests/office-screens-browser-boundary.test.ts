import { expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

test("office-screens browser evaluation cannot reach node:async_hooks through static runtime imports", () => {
  const root = resolve(import.meta.dir, "..");
  const entry = resolve(root, "src/lib/office-screens.functions.ts");
  const transpiler = new Bun.Transpiler({ loader: "tsx" });
  const visited = new Set<string>();
  const leaks: string[][] = [];

  function visit(file: string, chain: string[]) {
    if (visited.has(file)) return;
    visited.add(file);
    // Transpilation removes type-only dependencies; scanning follows actual static
    // runtime imports, not handler-local dynamic imports or source-text matches.
    const runtime = transpiler.transformSync(readFileSync(file, "utf8"));
    for (const dependency of transpiler.scan(runtime).imports) {
      if (dependency.kind !== "import-statement") continue;
      const name = dependency.path;
      if (name === "node:async_hooks" || name === "async_hooks") {
        leaks.push([...chain, name]);
        continue;
      }
      const base = name.startsWith("@/") ? resolve(root, "src", name.slice(2))
        : name.startsWith(".") ? resolve(dirname(file), name) : null;
      if (!base) continue;
      const target = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]
        .find((candidate) => existsSync(candidate) && /\.[cm]?[jt]sx?$/.test(candidate));
      if (!target) throw new Error(`Unresolved local runtime import: ${file} -> ${name}`);
      visit(target, [...chain, target.slice(root.length + 1)]);
    }
  }

  visit(entry, ["src/lib/office-screens.functions.ts"]);
  expect(leaks).toEqual([]);
});