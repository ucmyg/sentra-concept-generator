/**
 * Why this exists: EQUIVALENT_TO_KNOWN is 0 across all 767 verdicts of the
 * exhaustive run. Zero is either a fact about the candidates or a detector that
 * cannot fire. Nobody has watched this one fire on real enumerated input, so
 * per sweep:red discipline it is unproven until it is watched.
 *
 * Two probes, both on real survivors from the reference run:
 *
 *   RENAME  — take a survivor, rename its introduced operation symbol, and ask
 *             whether the checker calls the copy equivalent to the original.
 *             A NO here means the killer is blind to pure renaming, which would
 *             explain the zero by construction rather than by fact.
 *
 *   PAIRWISE — ask every ordered survivor pair. The run already checked each
 *             candidate against every earlier survivor, so a YES here is a
 *             direct contradiction: the killer had the same question in front
 *             of it during the run and answered differently.
 *
 * Usage: node tools/probe-equivalence.mjs [survivors.json] [--pairs N]
 */
import { readFileSync } from 'node:fs';
import { checkEquivalence } from '../src/foundry/equivalence.ts';

const DEFAULT_SURVIVORS =
  'foundry-ledger/runs/exhaustive-hashed-0001/survivors.json';
const DEFAULT_PAIR_BUDGET = 400;

const args = process.argv.slice(2);
const pairFlag = args.indexOf('--pairs');
const pairBudget =
  pairFlag === -1 ? DEFAULT_PAIR_BUDGET : Number(args[pairFlag + 1]);
const survivorsPath =
  args.find((a) => !a.startsWith('--') && a !== String(pairBudget)) ??
  DEFAULT_SURVIVORS;

const survivors = JSON.parse(readFileSync(survivorsPath, 'utf8'));
if (!Array.isArray(survivors) || survivors.length === 0) {
  console.error(`no survivors in ${survivorsPath}`);
  process.exit(2);
}

const OPTIONS = { maxModelSize: 3, interpretation: true };

/** Consistently rewrite one operation symbol everywhere it appears. */
const renameOp = (foundation, from, to) => {
  const term = (t) =>
    t && typeof t === 'object' && 'op' in t
      ? { ...t, op: t.op === from ? to : t.op, args: (t.args ?? []).map(term) }
      : t;
  return {
    ...foundation,
    id: `${foundation.id}~renamed`,
    operations: foundation.operations.map((o) =>
      o.name === from ? { ...o, name: to } : o,
    ),
    rules: foundation.rules.map((r) => ({
      ...r,
      id: `${r.id}~renamed`,
      lhs: term(r.lhs),
      rhs: term(r.rhs),
    })),
  };
};

/** The operation this candidate introduced — the one its parent lacks. */
const introducedOp = (foundation) =>
  foundation.operations.find((o) => o.name.startsWith('gen_'))?.name ?? null;

console.log(`survivors: ${survivors.length}  from ${survivorsPath}\n`);

// ---- probe 1: rename ------------------------------------------------------
let renameYes = 0;
let renameNo = 0;
const renameFailures = [];
for (const f of survivors) {
  const op = introducedOp(f);
  if (!op) continue;
  const verdict = checkEquivalence(f, renameOp(f, op, `${op}_renamed`), OPTIONS);
  if (verdict.equivalent) renameYes += 1;
  else {
    renameNo += 1;
    if (renameFailures.length < 3)
      renameFailures.push({ id: f.id, stage: verdict.stage, notes: verdict.notes });
  }
}
console.log('RENAME probe — a system versus itself with one symbol renamed');
console.log(`  equivalent: ${renameYes}   NOT equivalent: ${renameNo}`);
if (renameNo > 0) {
  console.log('  the checker fails to identify a system with a renamed copy of itself:');
  for (const f of renameFailures)
    console.log(`    ${f.id}  stage=${f.stage}\n      ${(f.notes ?? []).join('\n      ')}`);
}

// ---- probe 2: pairwise ----------------------------------------------------
const pairs = [];
outer: for (let i = 0; i < survivors.length; i += 1) {
  for (let j = i + 1; j < survivors.length; j += 1) {
    pairs.push([i, j]);
    if (pairs.length >= pairBudget) break outer;
  }
}
let pairYes = 0;
const collisions = [];
for (const [i, j] of pairs) {
  const verdict = checkEquivalence(survivors[i], survivors[j], OPTIONS);
  if (verdict.equivalent) {
    pairYes += 1;
    if (collisions.length < 5)
      collisions.push(`${survivors[i].id} == ${survivors[j].id} (stage ${verdict.stage})`);
  }
}
console.log('\nPAIRWISE probe — survivors against each other');
console.log(`  pairs asked: ${pairs.length} of ${(survivors.length * (survivors.length - 1)) / 2}`);
console.log(`  equivalent: ${pairYes}`);
for (const c of collisions) console.log(`    ${c}`);
if (pairs.length < (survivors.length * (survivors.length - 1)) / 2)
  console.log(`  NOTE: truncated at --pairs ${pairBudget}. This is not a full sweep.`);

console.log('\nreading:');
if (renameNo > 0)
  console.log('  the zero is at least partly structural — the detector cannot see through renaming.');
else if (pairYes > 0)
  console.log('  the detector CAN fire, and the run should have fired it. That is a contradiction to chase.');
else
  console.log('  detector fires on renames and finds no survivor collisions: the zero survives this probe.');
