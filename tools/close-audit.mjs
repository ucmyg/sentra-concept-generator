/**
 * CLOSE THE AUDIT — by content identity, not by name.
 *
 * The preserved audit run predates candidate_hash, so its entries carry only
 * positional ids. But the enumerator and the sampler are both deterministic
 * functions of the run seed, and that seed IS recorded. So the rule sitting at
 * each index is recoverable by replay: enumerate the same candidates, draw the
 * same seeded sample, and read off what index N actually was.
 *
 * That turns "36 verdicts whose subjects are unknown" into 36 verdicts with
 * content hashes — which can then be compared against the exhaustive run for
 * real. Without this step every cross-run comparison is aliasing: the first
 * attempt reported 22 of 36 reversed and not one of them was.
 *
 *   node tools/close-audit.mjs
 */
import { readFileSync } from 'node:fs';

import { stableStringify } from '../src/canonical-json.ts';
import {
  CANDIDATE_OPERATIONS,
  DEFAULT_ENUMERATION_BOUND,
  enumerateRuleCandidates,
  seededSample,
} from '../src/foundry/enumerate.ts';
import { seedFoundations } from '../src/foundry/generator.ts';
import { candidateHash } from '../src/foundry/screen-ledger.ts';

const load = (p) =>
  readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

const OLD = 'foundry-ledger/preserved/audit-run-36of767.jsonl';
// Reference run is an argument, not a constant. Hardcoding it is how this
// script ended up comparing against a build that predated content identities.
const NEW =
  process.argv[2] ?? 'foundry-ledger/runs/exhaustive-hashed-0001/screen-ledger.jsonl';

const oldVerdicts = load(OLD).filter((e) => e.kind === 'VERDICT');
const newVerdicts = load(NEW).filter((e) => e.kind === 'VERDICT');

const oldSeed = oldVerdicts[0].run_seed;
// 36 verdicts over 3 parents x 2 operations => 6 per (parent, op) pair.
const sampleSize = oldVerdicts.length / (seedFoundations().length * CANDIDATE_OPERATIONS.length);

/** Replay a run's batching to recover what each positional index actually was. */
function replay(seed, size) {
  const byId = new Map();
  for (const parent of seedFoundations()) {
    for (const op of CANDIDATE_OPERATIONS) {
      const all = enumerateRuleCandidates(parent, op, DEFAULT_ENUMERATION_BOUND);
      const batch =
        size === undefined ? all : seededSample(all, size, `${seed}:${parent.id}:${op.name}`);
      batch.forEach((c, i) => {
        byId.set(`${parent.id}-gen-${op.name}-${i}`, {
          hash: candidateHash({ parent_id: parent.id, new_operation: op, rule: c.rule }),
          rule: c.rule,
        });
      });
    }
  }
  return byId;
}

const oldById = replay(oldSeed, sampleSize);
const newById = replay(newVerdicts[0].run_seed, undefined);

// Sanity: the replay of the exhaustive run must reproduce the hashes it wrote.
let replayOk = 0;
for (const v of newVerdicts) {
  const r = newById.get(v.candidate_id);
  if (r && v.candidate_hash && r.hash === v.candidate_hash) replayOk += 1;
}
console.log(`replay check: ${replayOk}/${newVerdicts.length} exhaustive hashes reproduced`);

// HARD GATE. The first version of this check let itself be skipped when the
// reference run carried no hashes — so the comparison ran on replay-derived
// hashes on BOTH sides and agreed with itself 36/36 while proving nothing. A
// check that disables itself when its evidence is missing is not a check.
// Missing evidence is a STOP, never a pass.
if (!newVerdicts.every((v) => typeof v.candidate_hash === 'string' && v.candidate_hash.length === 64)) {
  console.error(
    'REFERENCE RUN CARRIES NO CONTENT IDENTITIES — the replay has nothing to be wrong against. ' +
      'Re-run the exhaustive screen with a build that records candidate_hash. Refusing to report.',
  );
  process.exit(2);
}
if (replayOk !== newVerdicts.length) {
  console.error(
    `REPLAY IS NOT FAITHFUL — ${newVerdicts.length - replayOk} of ${newVerdicts.length} ` +
      'recomputed identities disagree with the ledger. The audit cannot be closed by replay.',
  );
  process.exit(2);
}

// Exhaustive verdicts keyed by content.
const exhaustiveByHash = new Map();
for (const v of newVerdicts) {
  // Ledger identity only. The fallback that used to sit here is what made
  // the comparison self-confirming.
  exhaustiveByHash.set(v.candidate_hash, v);
}

const rows = { CONFIRMED: [], REVERSED: [], UNVERIFIABLE: [] };
for (const v of oldVerdicts) {
  const recovered = oldById.get(v.candidate_id);
  if (!recovered) {
    rows.UNVERIFIABLE.push({ id: v.candidate_id, why: 'index not recoverable by replay' });
    continue;
  }
  const match = exhaustiveByHash.get(recovered.hash);
  if (!match) {
    rows.UNVERIFIABLE.push({ id: v.candidate_id, why: 'candidate absent from exhaustive run' });
    continue;
  }
  const row = {
    audit_id: v.candidate_id,
    exhaustive_id: match.candidate_id,
    hash: recovered.hash.slice(0, 12),
    then: v.outcome,
    now: match.outcome,
  };
  if (v.outcome === match.outcome) rows.CONFIRMED.push(row);
  else rows.REVERSED.push(row);
}

console.log(`\naudit run: seed=${oldSeed} sampleSize=${sampleSize} verdicts=${oldVerdicts.length}`);
console.log(`exhaustive run: seed=${newVerdicts[0].run_seed} verdicts=${newVerdicts.length}`);
console.log(`\nCONFIRMED:    ${rows.CONFIRMED.length}`);
console.log(`REVERSED:     ${rows.REVERSED.length}`);
console.log(`UNVERIFIABLE: ${rows.UNVERIFIABLE.length}`);

// THE CHECK THIS AUDIT EXISTED FOR: a candidate the earlier run killed that the
// exhaustive run resurrects. That is a wrongly-executed concept, by name.
const resurrected = rows.REVERSED.filter((r) => r.then !== 'SURVIVED' && r.now === 'SURVIVED');
console.log(`\nWRONGLY EXECUTED (killed then, survives now): ${resurrected.length}`);
for (const r of resurrected) {
  console.log(`  ${r.exhaustive_id}  hash=${r.hash}  ${r.then} -> ${r.now}`);
}
const lost = rows.REVERSED.filter((r) => r.then === 'SURVIVED' && r.now !== 'SURVIVED');
console.log(`\nSURVIVED THEN, KILLED NOW: ${lost.length}`);
for (const r of lost) console.log(`  ${r.exhaustive_id}  hash=${r.hash}  ${r.then} -> ${r.now}`);

console.log(`\n${stableStringify(rows).length} bytes of table detail available`);
