import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DISTINCTION_ALGEBRA } from '../../src/foundry/generator.ts';
import { runScreen } from '../../src/foundry/screen.ts';

/* ------------------------------------------------------------------ *
 * THE ALIASING PIN                                                    *
 *                                                                     *
 * candidate_id is positional: "<parent>-gen-<op>-<index>". Under      *
 * sampling the batch is a seeded shuffle, so index N is a different   *
 * rule in every run. Comparing two runs by candidate_id therefore     *
 * reports reversals that never happened — 22 of 36 on the first real  *
 * attempt, every one of them an alias.                                *
 *                                                                     *
 * candidate_hash is derived from the candidate itself. These tests    *
 * hold the two apart so a future audit cannot key on the wrong one.   *
 * ------------------------------------------------------------------ */

/*
 * Bounded on purpose. These are claims about identity, not about coverage —
 * they need two runs over the SAME candidate stream, not a large one. The
 * unbounded version enumerated 767 per run and took twelve minutes a call,
 * which hung `npm test` for over half an hour and meant the suite stopped
 * being run at all. A test nobody waits for is a test nobody has.
 *
 * Exhaustive here means "not sampled" — every candidate the bound produces is
 * screened. That is the property these tests actually rest on.
 */
const IDENTITY_BOUND = { maxDepth: 2, maxVars: 2, maxCandidates: 24 } as const;

const verdicts = (seed: string, sampleSize?: number) =>
  runScreen([DISTINCTION_ALGEBRA], { seed, sampleSize, enumeration: IDENTITY_BOUND })
    .ledger.all()
    .filter((e) => e.kind === 'VERDICT');

test('candidate_id aliases across runs — the same id names different rules', () => {
  const a = verdicts('alias-a', 4);
  const b = verdicts('alias-b', 4);

  const byId = new Map(a.map((e) => [e.candidate_id, e]));
  const shared = b.filter((e) => byId.has(e.candidate_id));
  assert.ok(shared.length > 0, 'the two sampled runs must share candidate_ids at all');

  const aliased = shared.filter((e) => byId.get(e.candidate_id)!.candidate_hash !== e.candidate_hash);
  assert.ok(
    aliased.length > 0,
    'if this ever passes with zero aliases, candidate_id became content-derived and the ' +
      'warning in the ledger docs is stale — check before deleting it',
  );
});

test('candidate_hash is stable for the same candidate across different runs', () => {
  // Exhaustive runs enumerate in the same order, so the same rules appear in
  // both. Their hashes must match even though the runs carry different seeds.
  const a = verdicts('stable-a');
  const b = verdicts('stable-b');

  const ha = a.map((e) => e.candidate_hash).sort();
  const hb = b.map((e) => e.candidate_hash).sort();
  assert.deepEqual(ha, hb, 'identity must not depend on the run seed');
});

test('a hash identifies exactly one candidate within a run', () => {
  const a = verdicts('unique');
  const seen = new Set(a.map((e) => e.candidate_hash));
  assert.equal(seen.size, a.length, 'two distinct candidates collided on one hash');
});

test('every verdict carries an identity; headers and observations carry none', () => {
  const all = runScreen([DISTINCTION_ALGEBRA], {
    seed: 'ident',
    sampleSize: 3,
    enumeration: IDENTITY_BOUND,
  }).ledger.all();
  for (const e of all) {
    if (e.kind === 'VERDICT') assert.match(e.candidate_hash, /^[0-9a-f]{64}$/);
    else assert.equal(e.candidate_hash, '');
  }
});
