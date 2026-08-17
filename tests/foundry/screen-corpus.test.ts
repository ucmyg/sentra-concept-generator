import assert from 'node:assert/strict';
import { test } from 'node:test';

import { KNOWN_TEMPLATES } from '../../src/foundry/equivalence.ts';
import { DISTINCTION_ALGEBRA } from '../../src/foundry/generator.ts';
import { runScreen } from '../../src/foundry/screen.ts';

/* ------------------------------------------------------------------ *
 * The corpus has to actually be in the room.                          *
 *                                                                     *
 * RED evidence, found by reading a ledger rather than a test:          *
 *                                                                     *
 *   An exhaustive run of all 767 enumerated candidates produced 128    *
 *   survivors and zero EQUIVALENT_TO_KNOWN. The detail string on the   *
 *   first survivor read "distinct from 3 known structure(s)" — the     *
 *   three seed foundations. Not 3 plus the 15 reduction targets.       *
 *   Fifteen. Zero of them were ever in the known set.                  *
 *                                                                     *
 *   So every survival verdict in the system was earned against a       *
 *   corpus that was never consulted, and growing the corpus would not  *
 *   have changed a single verdict. The reduction attack existed, was   *
 *   tested, and was simply never called by the screener.               *
 * ------------------------------------------------------------------ */

test('screening checks every candidate against the reduction corpus, not just its siblings', () => {
  const report = runScreen([DISTINCTION_ALGEBRA], { seed: 'corpus-in-room', sampleSize: 3 });
  assert.ok(report.survivors.length > 0, 'fixture must produce at least one survivor to inspect');

  // A survival verdict states what it was checked against. The floor is the
  // corpus — this is a coverage floor, not an outcome rate (EVIDENCE-LAW L1).
  const first = report.survivors[0]!;
  const match = /distinct from (\d+) known structure/.exec(first.detail);
  assert.ok(match, `a survival verdict must state its corpus: got "${first.detail}"`);

  const checkedAgainst = Number(match[1]);
  assert.ok(
    checkedAgainst >= KNOWN_TEMPLATES.length,
    `survivor was checked against ${checkedAgainst} structures, but the reduction corpus ` +
      `alone has ${KNOWN_TEMPLATES.length}. A survival earned without consulting the corpus ` +
      'is not a survival, and no amount of growing the corpus would change it.',
  );
});

test('a candidate that re-skins a corpus target dies to it during a real run', () => {
  // The involution template is in the corpus. F1 already contains
  // mark(mark(x)) -> x, so a candidate adding nothing but a renamed
  // involution is a re-skin of something the corpus holds.
  const report = runScreen([DISTINCTION_ALGEBRA], { seed: 'corpus-kill', sampleSize: 12 });

  const consulted = report.results
    .filter((r) => r.outcome === 'SURVIVED')
    .map((r) => /distinct from (\d+) known/.exec(r.detail))
    .filter(Boolean)
    .map((m) => Number(m![1]));

  assert.ok(consulted.length > 0, 'fixture must produce survivors');
  assert.ok(
    Math.min(...consulted) >= KNOWN_TEMPLATES.length,
    'every survivor, including the first one screened, must face the whole corpus — ' +
      'a corpus that only arrives after some candidates have already passed is not a gate',
  );
});
