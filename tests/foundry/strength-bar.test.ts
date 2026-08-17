import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  admitCoverage,
  corpusCeiling,
  ruleOnAttempt,
  type FamilyAttempt,
} from '../../src/foundry/levels.ts';

/* ------------------------------------------------------------------ *
 * THE PIN                                                             *
 *                                                                     *
 * A shallow attempt against a fresh family must move the ceiling by   *
 * exactly zero. Without this, wide-shallow and deep are not two       *
 * strategies — they are the honest and dishonest versions of the same *
 * number.                                                             *
 * ------------------------------------------------------------------ */

const strong = (family: string, claims: 'FULL' | 'PARTIAL' = 'FULL'): FamilyAttempt => ({
  family,
  claims,
  target_triple: {
    has_formal_definition: true,
    planted_reskin_died: true,
    distinct_system_survived: true,
  },
  search: { declared_full_strength: true, parameters: { depth: 4, timeout_ms: 30_000 } },
});

const shallow = (family: string, over: Partial<FamilyAttempt> = {}): FamilyAttempt => ({
  ...strong(family),
  search: { declared_full_strength: false, parameters: { depth: 1 } },
  ...over,
});

test('a shallow attempt against a fresh family does not move the ceiling', () => {
  const base = admitCoverage([strong('order'), strong('groups'), strong('lattices')]);
  const before = corpusCeiling(base.coverage);

  const widened = admitCoverage([
    strong('order'),
    strong('groups'),
    strong('lattices'),
    shallow('state-transition'), // brand new family, tasted not attacked
  ]);
  const after = corpusCeiling(widened.coverage);

  assert.equal(after.ceiling, before.ceiling, 'a weak attack raised the ceiling');
  assert.equal(
    after.effective_families,
    before.effective_families,
    'a weak attack was counted as coverage',
  );
  assert.deepEqual(
    widened.attempted_not_covered.map((r) => r.family),
    ['state-transition'],
    'the weak attempt must be named as evidence, not silently dropped',
  );
});

test('each leg of the triple is load-bearing on its own', () => {
  const legs: Array<[keyof FamilyAttempt['target_triple'], string]> = [
    ['has_formal_definition', 'NO_FORMAL_DEFINITION'],
    ['planted_reskin_died', 'PLANTED_RESKIN_SURVIVED'],
    ['distinct_system_survived', 'DISTINCT_SYSTEM_DIED'],
  ];
  for (const [leg, code] of legs) {
    const a = strong('order');
    const broken: FamilyAttempt = { ...a, target_triple: { ...a.target_triple, [leg]: false } };
    const ruling = ruleOnAttempt(broken);
    assert.equal(ruling.admitted, false, `${leg} was not load-bearing`);
    assert.ok(ruling.reasons.includes(code as never), `expected ${code}`);
    assert.equal(corpusCeiling(admitCoverage([broken]).coverage).effective_families, 0);
  }
});

test('an unrecorded search parameter set is not full strength', () => {
  const a = strong('order');
  const ruling = ruleOnAttempt({ ...a, search: { declared_full_strength: true, parameters: null } });
  assert.equal(ruling.admitted, false);
  assert.deepEqual(ruling.reasons, ['SEARCH_PARAMETERS_NOT_RECORDED']);
});

test('the bar admits real attacks — it is a bar, not a wall', () => {
  const six = ['order', 'groups', 'lattices', 'rings', 'topology', 'categories'].map((f) =>
    strong(f),
  );
  const admitted = admitCoverage(six);
  assert.equal(admitted.attempted_not_covered.length, 0);
  assert.equal(corpusCeiling(admitted.coverage).effective_families, 6);
  assert.ok(corpusCeiling(admitted.coverage).ceiling >= 5);
});

test('a partial claim that clears the bar still counts half, not full', () => {
  const full = corpusCeiling(admitCoverage([strong('order'), strong('groups')]).coverage);
  const part = corpusCeiling(
    admitCoverage([strong('order'), strong('groups', 'PARTIAL')]).coverage,
  );
  assert.ok(
    part.effective_families < full.effective_families,
    'clearing the strength bar must not upgrade a partial claim to a full one',
  );
});
