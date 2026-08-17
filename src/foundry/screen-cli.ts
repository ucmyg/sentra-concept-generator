import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { stableStringify } from '../canonical-json.ts';

import { seedFoundations } from './generator.ts';
import { runScreen } from './screen.ts';

/* ------------------------------------------------------------------ *
 * Screening entrypoint.                                               *
 *                                                                     *
 * Until this existed, screening runs were driven by throwaway scripts *
 * and their verdicts were never written anywhere. The survivors file  *
 * in foundry-out came from one of those. That is how an audit of      *
 * every historical equivalence kill came back empty while the killer  *
 * had been firing all along.                                          *
 *                                                                     *
 * Usage: node src/foundry/screen-cli.ts [outDir] [seed] [sampleSize]  *
 * ------------------------------------------------------------------ */

const outDir = resolve(process.argv[2] ?? 'foundry-out');
const seed = process.argv[3] ?? 'default-run';
const sampleArg = process.argv[4];
const sampleSize = sampleArg === undefined ? undefined : Number(sampleArg);

if (sampleSize !== undefined && !Number.isFinite(sampleSize)) {
  console.error(`sampleSize must be a number, got: ${sampleArg}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const report = runScreen(seedFoundations(), { seed, sampleSize });

// The ledger first. If anything below throws, the verdicts are already safe.
writeFileSync(resolve(outDir, 'screen-ledger.jsonl'), report.ledger.toJSONL(), 'utf8');

const chain = report.ledger.verify();
if (!chain.ok) {
  console.error('LEDGER CHAIN BROKEN — refusing to report results over an unverifiable record.');
  console.error(stableStringify(chain.broken));
  process.exit(2);
}

writeFileSync(
  resolve(outDir, 'survivors.json'),
  stableStringify(report.survivors.map((s) => s.foundation)),
  'utf8',
);

const kills = report.ledger.terminalVerdicts();
const unevidenced = kills.filter((k) => k.evidence === null);

console.log(`seed: ${seed}`);
console.log(`enumerated: ${report.candidates_enumerated}  screened: ${report.candidates_screened}`);
console.log(`ledger: ${report.ledger.length} entries, chain verified`);
// Outcome counts are reported, never asserted on. See docs/genesis/EVIDENCE-LAW.md L1.
for (const [outcome, n] of Object.entries(report.tally)) console.log(`  ${outcome}: ${n}`);

if (unevidenced.length > 0) {
  console.error(
    `\n${unevidenced.length} terminal verdict(s) were issued with NO evidence attached. ` +
      'Each one is unauditable and therefore cannot stand:',
  );
  for (const k of unevidenced) console.error(`  seq ${k.seq}: ${k.candidate_id}`);
  process.exit(3);
}
