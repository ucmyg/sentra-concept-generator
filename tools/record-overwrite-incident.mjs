/**
 * ITEM 1 — the overwrite goes into the chain as an observation, not into a
 * chat log as a confession.
 *
 * Run once. Idempotent: refuses to double-append the same incident id.
 *
 *   node tools/record-overwrite-incident.mjs
 */
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { stableStringify } from '../src/canonical-json.ts';
import { loadRun } from '../src/foundry/run-store.ts';
import { ScreenLedger } from '../src/foundry/screen-ledger.ts';

const ROOT = resolve('foundry-ledger');
const INCIDENTS = resolve(ROOT, 'incidents.jsonl');
const PRESERVED = resolve(ROOT, 'preserved');

mkdirSync(PRESERVED, { recursive: true });

// Promote the preserved copy out of temp. Temp is where files go to die, and
// this one is the only surviving trace of the audit run.
const TEMP_COPY = resolve(process.env.TEMP ?? '/tmp', 'ledger-audit-run.jsonl');
const promoted = [];
for (const [src, name] of [
  [TEMP_COPY, 'audit-run-36of767.jsonl'],
  [resolve('foundry-out', 'screen-ledger-full-rescreen.jsonl'), 'exhaustive-rescreen-767.jsonl'],
  [resolve('foundry-out', 'survivors-full-rescreen.json'), 'exhaustive-rescreen-survivors.json'],
]) {
  if (!existsSync(src)) continue;
  const dest = resolve(PRESERVED, name);
  copyFileSync(src, dest);
  promoted.push({ from: src, to: dest, bytes: readFileSync(dest).length });
}

const INCIDENT_ID = 'INC-2026-08-16-fixed-path-overwrite';

// The incidents chain is the one fixed path in the system, and that is safe
// precisely because it is APPEND-only — appending never destroys what is
// already there. The overwrite class was fixed-path plus truncating write.
const sink = (entry) => appendFileSync(INCIDENTS, `${stableStringify(entry)}\n`, 'utf8');
const ledger = existsSync(INCIDENTS) ? loadRun(INCIDENTS, sink) : new ScreenLedger(sink);

if (ledger.all().some((e) => e.evidence?.incident_id === INCIDENT_ID)) {
  console.log(`${INCIDENT_ID} already recorded at seq ${ledger.all().findIndex((e) => e.evidence?.incident_id === INCIDENT_ID)}`);
  process.exit(0);
}

ledger.observe(
  'ledger-integrity',
  'verdict-bearing artifacts destroyed by fixed-path writes',
  {
    incident_id: INCIDENT_ID,
    code_path: 'src/foundry/screen-cli.ts — writeFileSync to a fixed screen-ledger.jsonl / survivors.json',
    occurrences: [
      {
        when: '2026-08-16 ~20:26 local',
        what: 'the throwaway screening run that produced foundry-out/survivors.json',
        contents_to_best_knowledge: {
          candidates_screened: 60,
          candidates_enumerated: 233,
          parent: 'F1',
          seed: 'UNRECORDED — the run predates the entrypoint, so no seed was ever written down',
          survivor_identities: 'NOT RECOVERABLE — no trace survives in foundry-out, temp, or scrollback',
        },
        recovered: false,
      },
      {
        when: '2026-08-16 22:23 local',
        what: "the exhaustive re-screen's ledger (767 of 767, seed full-rescreen), overwritten at the same fixed path by a corpus run seeded corpus-in-room",
        contents_to_best_knowledge: {
          candidates_screened: 767,
          candidates_enumerated: 767,
          survived: 128,
        },
        recovered: true,
        recovery: 'a hand-made copy, screen-ledger-full-rescreen.jsonl, made before the clobber; candidate ids and outcomes verified identical to the surviving file',
        note: 'this occurrence fired FORTY MINUTES AFTER the law was written stating in-memory verdicts are not history, and was caught only because a copy happened to exist. Procedure did not prevent it. Structure now does.',
      },
    ],
    consequence: {
      throwaway_run_verdicts: 'VERDICT_UNVERIFIABLE by construction — no evidence exists to uphold or overturn them',
      superseded_by: 'the exhaustive run, seed full-rescreen, 767/767, chain verified',
      audit_table_rule: "the throwaway run's row cites this entry rather than claiming a verdict",
    },
    remediation: {
      structural: 'run-scoped output directories; no shared mutable filename for anything verdict-bearing',
      pinned_by: 'tests/foundry/run-store.test.ts — "a second run cannot alter the first run byte-for-byte"',
      durability: 'ledger moved out of gitignored foundry-out into committed foundry-ledger',
    },
    promoted_artifacts: promoted,
  },
  'the chain records its own failures, or it is decoration',
);

console.log(`recorded ${INCIDENT_ID} — incidents chain now ${ledger.length} entries`);
const check = ledger.verify();
console.log(`chain verified: ${check.ok}`);
if (!check.ok) {
  console.error(JSON.stringify(check.broken));
  process.exit(2);
}
for (const p of promoted) console.log(`promoted: ${p.to} (${p.bytes} bytes)`);
