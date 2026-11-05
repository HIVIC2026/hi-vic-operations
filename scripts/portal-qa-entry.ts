// Isolated mode must branch before importing the production-connected runner.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { uiRouteInventory } from './portal-qa-coverage';
if (process.argv.includes('--isolated')) {
  const out = process.env.PORTAL_QA_ISOLATED_OUT || '/tmp/portal-qa-isolated';
  const { mkdirSync } = await import('node:fs');
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/route-inventory.json`, JSON.stringify(uiRouteInventory(await Bun.file('src/routeTree.gen.ts').text()), null, 2));
  const result = spawnSync('python3', ['tests/portal-isolated/browser.py', out], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
} else {
  await import('./portal-qa');
}
