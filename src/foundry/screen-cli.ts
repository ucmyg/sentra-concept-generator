import { stableStringify } from '../canonical-json.ts';

import { seedFoundations } from './generator.ts';
import { DEFAULT_LEDGER_ROOT, openRunDir } from './run-store.ts';
import { ScreenLedger } from './screen-ledger.ts';
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
 * Every invocation writes into its own stamped run directory. There is  *
 * no shared mutable filename for anything verdict-bearing, because a    *
 * fixed path meant each run destroyed the last one's record — and that  *
 * happened twice before it was made impossible.                         *
 *                                                                       *
 * Usage: node src/foundry/screen-cli.ts [ledgerRoot] [seed] [sampleSize] *
 * ------------------------------------------------------------------ */

const ledgerRoot = process.argv[2] ?? DEFAULT_LEDGER_ROOT;
const seed = process.argv[3] ?? 'default-run';
const sampleArg = process.argv[4];
const sampleSize = sampleArg === undefined ? undefined : Number(sampleArg);

if (sampleSize !== undefined && !Number.isFinite(sampleSize)) {
  console.error(`sampleSize must be a number, got: ${sampleArg}`);
  process.exit(1);
}

const run = openRunDir(ledgerRoot, seed);

// The sink writes each verdict at the moment it is issued, so a killed process
// leaves a valid partial chain rather than nothing. "Ledger first" was right;
// "and durable before the next candidate is screened" is its missing half.
const report = runScreen(seedFoundations(), {
  seed,
  sampleSize,
  ledger: new ScreenLedger(run.sink),
});

const chain = report.ledger.verify();
if (!chain.ok) {
  console.error('LEDGER CHAIN BROKEN — refusing to report results over an unverifiable record.');
  console.error(stableStringify(chain.broken));
  process.exit(2);
}

run.writeArtifact('survivors.json', stableStringify(report.survivors.map((s) => s.foundation)));

const kills = report.ledger.terminalVerdicts();
const unevidenced = kills.filter((k) => k.evidence === null);

console.log(`run: ${run.runId}`);
console.log(`dir: ${run.dir}`);
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
